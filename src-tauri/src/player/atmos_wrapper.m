#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/CoreAudio.h>
#import <MediaToolbox/MediaToolbox.h>
#import <Accelerate/Accelerate.h>
#import <objc/runtime.h>
#import <stdlib.h>
#import <string.h>
#import <stdatomic.h>

// --- EQ Processing Tap ---

typedef struct {
    float fc;
    float q;
    float gain;
    int filter_type; // 0 = Peaking

    // vDSP biquad setup
    vDSP_biquad_Setup biquadSetup;
    double biquadCoeffs[5];
    BOOL needsSetup;
    // Per-channel delay state: (sections+1)*2 = 4 floats per channel, up to 12 channels (7.1.4)
    float delay[12][4];
} EQBandContext;

// Sample ring buffer for LUFS/True Peak analysis on the Rust side.
// Interleaved float32 frames (channels tightly packed per frame).
// Single-producer (tap thread) / single-consumer (Rust worker) — head/tail atomic.
#define LUFS_RING_FRAMES 65536            // ~1.36s at 48kHz per channel
#define LUFS_RING_MAX_CHANNELS 12

typedef struct {
    float *data;                          // capacity: LUFS_RING_FRAMES * channels floats
    unsigned int capacityFrames;
    unsigned int channels;                // frozen after first non-zero write
    _Atomic unsigned int head;            // write index (frames), producer only
    _Atomic unsigned int tail;            // read index (frames), consumer only
    unsigned int sampleRate;              // Hz, for ebur128
} SampleRing;

typedef struct {
    BOOL enabled;
    float preamp;
    EQBandContext bands[20];
    int numBands;
    Float64 sampleRate;
    float meterRms[12];
    float meterPeak[12];
    int meterChannels;
    unsigned int meterSequence;
    unsigned int muteMask; // bit i = mute channel i (channel order matches meter labels)
    SampleRing lufsRing;
} EQContext;

static void calculate_biquad_coeffs(EQBandContext *band, Float64 sampleRate) {
    if (sampleRate <= 0) return;
    double w0 = 2.0 * M_PI * band->fc / sampleRate;
    double alpha = sin(w0) / (2.0 * band->q);
    double A = pow(10.0, band->gain / 40.0);

    double b0 = 1.0 + alpha * A;
    double b1 = -2.0 * cos(w0);
    double b2 = 1.0 - alpha * A;
    double a0 = 1.0 + alpha / A;
    double a1 = -2.0 * cos(w0);
    double a2 = 1.0 - alpha / A;

    // vDSP biquad expects coefficients in this order, normalized by a0:
    // a0 is the overall gain factor, but vDSP divides by a0 if we normalize:
    // b0/a0, b1/a0, b2/a0, a1/a0, a2/a0
    band->biquadCoeffs[0] = b0 / a0;
    band->biquadCoeffs[1] = b1 / a0;
    band->biquadCoeffs[2] = b2 / a0;
    band->biquadCoeffs[3] = a1 / a0;
    band->biquadCoeffs[4] = a2 / a0;

    if (band->biquadSetup) {
        vDSP_biquad_DestroySetup(band->biquadSetup);
    }
    band->biquadSetup = vDSP_biquad_CreateSetup(band->biquadCoeffs, 1);
    band->needsSetup = NO;
}

static void tap_InitCallback(MTAudioProcessingTapRef tap, void *clientInfo, void **tapStorageOut) {
    (void)tap;
    *tapStorageOut = clientInfo;
}

static void tap_FinalizeCallback(MTAudioProcessingTapRef tap) {
    EQContext *context = (EQContext *)MTAudioProcessingTapGetStorage(tap);
    if (context) {
        for (int i = 0; i < context->numBands; i++) {
            if (context->bands[i].biquadSetup) {
                vDSP_biquad_DestroySetup(context->bands[i].biquadSetup);
            }
        }
        if (context->lufsRing.data) {
            free(context->lufsRing.data);
            context->lufsRing.data = NULL;
        }
        free(context);
    }
}

static void tap_PrepareCallback(MTAudioProcessingTapRef tap, CMItemCount maxFrames, const AudioStreamBasicDescription *processingFormat) {
    (void)maxFrames;
    EQContext *context = (EQContext *)MTAudioProcessingTapGetStorage(tap);
    if (context) {
        context->sampleRate = processingFormat->mSampleRate;
        for (int i = 0; i < context->numBands; i++) {
            context->bands[i].needsSetup = YES;
        }
        // (Re)allocate the sample ring lazily on first Process call — we don't yet know channel count here.
        context->lufsRing.sampleRate = (unsigned int)processingFormat->mSampleRate;
    }
}

static void tap_UnprepareCallback(MTAudioProcessingTapRef tap) {
    (void)tap;
}

static void tap_ProcessCallback(MTAudioProcessingTapRef tap, CMItemCount numberFrames, MTAudioProcessingTapFlags flags, AudioBufferList *bufferListInOut, CMItemCount *numberFramesOut, MTAudioProcessingTapFlags *flagsOut) {
    (void)flags;
    OSStatus status = MTAudioProcessingTapGetSourceAudio(tap, numberFrames, bufferListInOut, flagsOut, NULL, numberFramesOut);
    if (status != noErr) return;

    EQContext *context = (EQContext *)MTAudioProcessingTapGetStorage(tap);
    if (!context) return;

    context->meterChannels = (bufferListInOut->mNumberBuffers < 12) ? (int)bufferListInOut->mNumberBuffers : 12;

    for (UInt32 bufIdx = 0; bufIdx < bufferListInOut->mNumberBuffers && bufIdx < 12; bufIdx++) {
        float *data = (float *)bufferListInOut->mBuffers[bufIdx].mData;
        UInt32 numSamples = bufferListInOut->mBuffers[bufIdx].mDataByteSize / sizeof(float);
        if (!data || numSamples == 0) {
            context->meterRms[bufIdx] = 0.0f;
            context->meterPeak[bufIdx] = 0.0f;
            continue;
        }

        float sumSquares = 0.0f;
        float peak = 0.0f;
        vDSP_svesq(data, 1, &sumSquares, numSamples);
        vDSP_maxmgv(data, 1, &peak, numSamples);
        context->meterRms[bufIdx] = sqrtf(sumSquares / (float)numSamples);
        context->meterPeak[bufIdx] = peak;
    }
    context->meterSequence++;

    // Push interleaved samples into the LUFS ring (pre-mute so LUFS reflects the actual file content).
    {
        UInt32 chCount = bufferListInOut->mNumberBuffers;
        if (chCount > LUFS_RING_MAX_CHANNELS) chCount = LUFS_RING_MAX_CHANNELS;

        UInt32 frameCount = 0;
        if (chCount > 0) {
            frameCount = bufferListInOut->mBuffers[0].mDataByteSize / sizeof(float);
        }

        SampleRing *ring = &context->lufsRing;

        // Lazy allocate on first non-zero call.
        if (!ring->data && chCount > 0 && frameCount > 0) {
            ring->channels = chCount;
            ring->capacityFrames = LUFS_RING_FRAMES;
            ring->data = (float *)calloc(ring->capacityFrames * ring->channels, sizeof(float));
            atomic_store(&ring->head, 0u);
            atomic_store(&ring->tail, 0u);
        }

        if (ring->data && chCount == ring->channels && frameCount > 0) {
            unsigned int head = atomic_load_explicit(&ring->head, memory_order_relaxed);
            unsigned int tail = atomic_load_explicit(&ring->tail, memory_order_acquire);
            unsigned int cap = ring->capacityFrames;
            unsigned int used = (head - tail) & (0xFFFFFFFFu); // wrapping subtract; interpret via % cap
            // Free space (in frames), leave 1 slot to disambiguate full vs empty.
            unsigned int freeFrames = cap - (used % cap) - 1;

            // Drop if the consumer has fallen too far behind — this is metering, not playback.
            if (freeFrames < frameCount) {
                // Advance tail past the oldest frames to make room. This drops the oldest samples.
                unsigned int drop = frameCount - freeFrames;
                atomic_store_explicit(&ring->tail, tail + drop, memory_order_release);
                tail += drop;
            }

            for (UInt32 f = 0; f < frameCount; f++) {
                unsigned int wf = (head + f) % cap;
                float *dst = ring->data + (size_t)wf * ring->channels;
                for (UInt32 c = 0; c < chCount; c++) {
                    float *chData = (float *)bufferListInOut->mBuffers[c].mData;
                    dst[c] = (chData && f < frameCount) ? chData[f] : 0.0f;
                }
            }
            atomic_store_explicit(&ring->head, head + frameCount, memory_order_release);
        }
    }

    // Channel mutes run after metering: PPM keeps showing source levels while muted channels go silent
    if (context->muteMask) {
        for (UInt32 bufIdx = 0; bufIdx < bufferListInOut->mNumberBuffers && bufIdx < 32; bufIdx++) {
            if ((context->muteMask >> bufIdx) & 1u) {
                float *muteData = (float *)bufferListInOut->mBuffers[bufIdx].mData;
                UInt32 muteSamples = bufferListInOut->mBuffers[bufIdx].mDataByteSize / sizeof(float);
                if (muteData && muteSamples > 0) {
                    vDSP_vclr(muteData, 1, muteSamples);
                }
            }
        }
    }

    if (!context->enabled) return;

    for (int i = 0; i < context->numBands; i++) {
        if (context->bands[i].needsSetup) {
            calculate_biquad_coeffs(&context->bands[i], context->sampleRate);
        }
    }

    float preampLinear = powf(10.0f, context->preamp / 20.0f);

    // Assuming non-interleaved float data (which is standard for CoreAudio processing)
    for (UInt32 bufIdx = 0; bufIdx < bufferListInOut->mNumberBuffers; bufIdx++) {
        float *data = (float *)bufferListInOut->mBuffers[bufIdx].mData;
        UInt32 numSamples = bufferListInOut->mBuffers[bufIdx].mDataByteSize / sizeof(float);
        
        // Apply preamp
        if (preampLinear != 1.0f) {
            vDSP_vsmul(data, 1, &preampLinear, data, 1, numSamples);
        }

        // Apply biquad bands (use per-channel delay state to avoid channel crosstalk)
        UInt32 ch = (bufIdx < 12) ? bufIdx : 11;
        for (int i = 0; i < context->numBands; i++) {
            if (context->bands[i].biquadSetup) {
                vDSP_biquad(context->bands[i].biquadSetup, context->bands[i].delay[ch], data, 1, data, 1, numSamples);
            }
        }
    }
}

static void setup_audio_tap(AVPlayerItem *item, EQContext *context) {
    MTAudioProcessingTapCallbacks callbacks = {
        .version = kMTAudioProcessingTapCallbacksVersion_0,
        .clientInfo = context,
        .init = tap_InitCallback,
        .finalize = tap_FinalizeCallback,
        .prepare = tap_PrepareCallback,
        .unprepare = tap_UnprepareCallback,
        .process = tap_ProcessCallback
    };

    MTAudioProcessingTapRef tap;
    OSStatus err = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap);
    if (err != noErr) {
        free(context);
        return;
    }

    AVMutableAudioMixInputParameters *params = nil;
    NSArray<AVAssetTrack *> *audioTracks = [item.asset tracksWithMediaType:AVMediaTypeAudio];
    if (audioTracks.count > 0) {
        params = [AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:audioTracks.firstObject];
    } else {
        params = [AVMutableAudioMixInputParameters audioMixInputParameters];
    }
    
    params.audioTapProcessor = tap;
    
    AVMutableAudioMix *mix = [AVMutableAudioMix audioMix];
    mix.inputParameters = @[params];
    item.audioMix = mix;
    
    CFRelease(tap);
}


void* atmos_create(const char* path) {
    NSString *urlString = [NSString stringWithUTF8String:path];
    NSURL *url = [NSURL fileURLWithPath:urlString];
    AVPlayerItem *item = [AVPlayerItem playerItemWithURL:url];
    item.allowedAudioSpatializationFormats = AVAudioSpatializationFormatMonoStereoAndMultichannel;
    AVPlayer *player = [AVPlayer playerWithPlayerItem:item];

    // Setup initial empty EQ context
    EQContext *eqCtx = (EQContext *)calloc(1, sizeof(EQContext));
    setup_audio_tap(item, eqCtx);
    objc_setAssociatedObject(player, "eqContext", [NSValue valueWithPointer:eqCtx], OBJC_ASSOCIATION_RETAIN);
    
    // Return retained player
    return (void*)CFBridgingRetain(player);
}

void atmos_destroy(void* player_ptr) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge_transfer AVPlayer*)player_ptr;
    [player pause];
}

void atmos_play(void* player_ptr) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    [player play];
}

void atmos_pause(void* player_ptr) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    [player pause];
}

void atmos_set_volume(void* player_ptr, float volume) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    player.volume = volume;
}

void atmos_seek(void* player_ptr, double position) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    [player seekToTime:CMTimeMakeWithSeconds(position, 1000)];
}

double atmos_get_position(void* player_ptr) {
    if (!player_ptr) return 0.0;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    return CMTimeGetSeconds(player.currentTime);
}

double atmos_get_duration(void* player_ptr) {
    if (!player_ptr) return 0.0;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    return CMTimeGetSeconds(player.currentItem.duration);
}

int atmos_is_playing(void* player_ptr) {
    if (!player_ptr) return 0;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    return player.rate != 0.0;
}

void atmos_set_output_device(void* player_ptr, const char* device_uid) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    if (!device_uid || device_uid[0] == '\0') {
        player.audioOutputDeviceUniqueID = nil;
    } else {
        player.audioOutputDeviceUniqueID = [NSString stringWithUTF8String:device_uid];
    }
}

void atmos_set_eq(void* player_ptr, int enabled, float preamp, const char* bands_json) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    
    NSValue *ctxVal = objc_getAssociatedObject(player, "eqContext");
    if (!ctxVal) return;
    EQContext *context = (EQContext *)[ctxVal pointerValue];
    if (!context) return;
    
    context->enabled = enabled;
    context->preamp = preamp;
    context->numBands = 0;
    
    if (bands_json && strlen(bands_json) > 0) {
        NSData *data = [[NSString stringWithUTF8String:bands_json] dataUsingEncoding:NSUTF8StringEncoding];
        NSArray *bandsArray = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([bandsArray isKindOfClass:[NSArray class]]) {
            for (NSDictionary *bandDict in bandsArray) {
                if (context->numBands >= 20) break;
                float fc = [bandDict[@"fc"] floatValue];
                float q = [bandDict[@"q"] floatValue];
                float gain = [bandDict[@"gain"] floatValue];
                
                context->bands[context->numBands].fc = fc;
                context->bands[context->numBands].q = q;
                context->bands[context->numBands].gain = gain;
                context->bands[context->numBands].filter_type = 0; // Peaking
                context->bands[context->numBands].needsSetup = YES;
                context->numBands++;
            }
        }
    }
}

void atmos_set_channel_mutes(void* player_ptr, unsigned int mute_mask) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;

    NSValue *ctxVal = objc_getAssociatedObject(player, "eqContext");
    if (!ctxVal) return;
    EQContext *context = (EQContext *)[ctxVal pointerValue];
    if (!context) return;

    context->muteMask = mute_mask;
}

// Drains up to `max_frames` interleaved f32 frames from the LUFS ring into `out`.
// `out` must hold at least `max_frames * channels` floats.
// Returns the number of frames actually written; also outputs the channel count and sample rate.
unsigned int atmos_drain_samples(void* player_ptr, float *out, unsigned int max_frames,
                                 unsigned int *out_channels, unsigned int *out_sample_rate) {
    if (out_channels) *out_channels = 0;
    if (out_sample_rate) *out_sample_rate = 0;
    if (!player_ptr || !out || max_frames == 0) return 0;

    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    NSValue *ctxVal = objc_getAssociatedObject(player, "eqContext");
    if (!ctxVal) return 0;
    EQContext *context = (EQContext *)[ctxVal pointerValue];
    if (!context || !context->lufsRing.data) return 0;

    SampleRing *ring = &context->lufsRing;
    unsigned int channels = ring->channels;
    unsigned int cap = ring->capacityFrames;
    if (out_channels) *out_channels = channels;
    if (out_sample_rate) *out_sample_rate = ring->sampleRate;

    unsigned int head = atomic_load_explicit(&ring->head, memory_order_acquire);
    unsigned int tail = atomic_load_explicit(&ring->tail, memory_order_relaxed);
    unsigned int available = head - tail;
    if (available > cap) available = cap;

    unsigned int toRead = available < max_frames ? available : max_frames;
    if (toRead == 0) return 0;

    for (unsigned int f = 0; f < toRead; f++) {
        unsigned int rf = (tail + f) % cap;
        float *src = ring->data + (size_t)rf * channels;
        float *dst = out + (size_t)f * channels;
        memcpy(dst, src, sizeof(float) * channels);
    }

    atomic_store_explicit(&ring->tail, tail + toRead, memory_order_release);
    return toRead;
}

// Clear the LUFS ring buffer — call on load, seek, or explicit LUFS reset.
void atmos_reset_lufs_ring(void* player_ptr) {
    if (!player_ptr) return;
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;
    NSValue *ctxVal = objc_getAssociatedObject(player, "eqContext");
    if (!ctxVal) return;
    EQContext *context = (EQContext *)[ctxVal pointerValue];
    if (!context) return;

    SampleRing *ring = &context->lufsRing;
    unsigned int head = atomic_load_explicit(&ring->head, memory_order_acquire);
    atomic_store_explicit(&ring->tail, head, memory_order_release);
}

// Generate a downsampled waveform overview for an audio file at `path`.
// Reads the file with AVAssetReader (offline, not through the player), sums all channels
// into a mono signal, and emits `num_bins` peak values in the [0.0, 1.0] range.
// Returns 0 on success; on failure returns 1 and leaves out[] zeroed.
int atmos_generate_waveform(const char* path, float* out, unsigned int num_bins) {
    if (!path || !out || num_bins == 0) return 1;
    memset(out, 0, sizeof(float) * num_bins);

    @autoreleasepool {
        NSString *urlStr = [NSString stringWithUTF8String:path];
        NSURL *url = [NSURL fileURLWithPath:urlStr];
        AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
        NSArray<AVAssetTrack *> *tracks = [asset tracksWithMediaType:AVMediaTypeAudio];
        if (tracks.count == 0) return 1;

        AVAssetTrack *track = tracks.firstObject;
        double duration = CMTimeGetSeconds(asset.duration);
        if (duration <= 0.0) return 1;

        NSError *err = nil;
        AVAssetReader *reader = [AVAssetReader assetReaderWithAsset:asset error:&err];
        if (err || !reader) return 1;

        NSDictionary *settings = @{
            AVFormatIDKey: @(kAudioFormatLinearPCM),
            AVLinearPCMBitDepthKey: @32,
            AVLinearPCMIsFloatKey: @YES,
            AVLinearPCMIsNonInterleaved: @NO, // interleaved for simplicity
            AVLinearPCMIsBigEndianKey: @NO,
        };
        AVAssetReaderTrackOutput *output = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:track outputSettings:settings];
        output.alwaysCopiesSampleData = NO;
        if (![reader canAddOutput:output]) return 1;
        [reader addOutput:output];

        if (![reader startReading]) return 1;

        // Estimate total frames from duration * (probably 48000) to size bins.
        double estRate = 48000.0;
        NSArray *descs = track.formatDescriptions;
        if (descs.count > 0) {
            CMAudioFormatDescriptionRef fmt = (__bridge CMAudioFormatDescriptionRef)descs[0];
            const AudioStreamBasicDescription *asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmt);
            if (asbd && asbd->mSampleRate > 0) estRate = asbd->mSampleRate;
        }
        double totalFrames = duration * estRate;
        double framesPerBin = totalFrames / (double)num_bins;
        if (framesPerBin < 1.0) framesPerBin = 1.0;

        unsigned int currentBin = 0;
        double frameCursor = 0.0;      // frame index within the file
        double binBoundary = framesPerBin;
        float currentPeak = 0.0f;

        CMSampleBufferRef sbuf = NULL;
        while ((sbuf = [output copyNextSampleBuffer])) {
            CMBlockBufferRef bbuf = CMSampleBufferGetDataBuffer(sbuf);
            if (!bbuf) { CFRelease(sbuf); continue; }

            size_t totalBytes = 0;
            char *rawData = NULL;
            OSStatus s = CMBlockBufferGetDataPointer(bbuf, 0, NULL, &totalBytes, &rawData);
            if (s != kCMBlockBufferNoErr || !rawData) { CFRelease(sbuf); continue; }

            // Interleaved float32; find channel count from the sample buffer format
            unsigned int channels = 1;
            CMFormatDescriptionRef fdesc = CMSampleBufferGetFormatDescription(sbuf);
            if (fdesc) {
                const AudioStreamBasicDescription *asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fdesc);
                if (asbd) channels = asbd->mChannelsPerFrame > 0 ? asbd->mChannelsPerFrame : 1;
            }
            unsigned int frameCount = (unsigned int)(totalBytes / sizeof(float) / channels);
            const float *samples = (const float *)rawData;

            for (unsigned int f = 0; f < frameCount; f++) {
                // Sum all channels (any signed) then take abs — this is a mono peak envelope.
                float mono = 0.0f;
                for (unsigned int c = 0; c < channels; c++) {
                    float v = samples[f * channels + c];
                    if (v < 0) v = -v;
                    if (v > mono) mono = v;
                }
                if (mono > currentPeak) currentPeak = mono;
                frameCursor += 1.0;
                if (frameCursor >= binBoundary) {
                    if (currentBin < num_bins) {
                        out[currentBin] = currentPeak > 1.0f ? 1.0f : currentPeak;
                        currentBin++;
                    }
                    currentPeak = 0.0f;
                    binBoundary += framesPerBin;
                    if (currentBin >= num_bins) break;
                }
            }
            CFRelease(sbuf);
            if (currentBin >= num_bins) break;
        }
        // Flush final partial bin
        if (currentBin < num_bins) {
            out[currentBin] = currentPeak > 1.0f ? 1.0f : currentPeak;
        }
        [reader cancelReading];
    }
    return 0;
}


char* atmos_get_meter_json(void* player_ptr) {
    if (!player_ptr) return strdup("{\"available\":false,\"channels\":[]}");
    AVPlayer *player = (__bridge AVPlayer*)player_ptr;

    NSValue *ctxVal = objc_getAssociatedObject(player, "eqContext");
    if (!ctxVal) return strdup("{\"available\":false,\"channels\":[]}");
    EQContext *context = (EQContext *)[ctxVal pointerValue];
    if (!context) return strdup("{\"available\":false,\"channels\":[]}");

    const char *labels12[12] = {"L", "R", "C", "LFE", "Ls", "Rs", "Lrs", "Rrs", "Ltf", "Rtf", "Ltr", "Rtr"};
    int count = context->meterChannels;
    if (count <= 0) count = 2;
    if (count > 12) count = 12;

    char *json = (char *)malloc(1024);
    if (!json) return strdup("{\"available\":false,\"channels\":[]}");

    int offset = snprintf(json, 1024, "{\"available\":true,\"mode\":\"%s\",\"sequence\":%u,\"channels\":[", count > 2 ? "multichannel" : "stereo", context->meterSequence);
    for (int i = 0; i < count && offset < 980; i++) {
        float rms = context->meterRms[i];
        float peak = context->meterPeak[i];
        if (!isfinite(rms)) rms = 0.0f;
        if (!isfinite(peak)) peak = 0.0f;
        if (rms > 1.0f) rms = 1.0f;
        if (peak > 1.0f) peak = 1.0f;
        offset += snprintf(json + offset, 1024 - offset,
            "%s{\"label\":\"%s\",\"rms\":%.5f,\"peak\":%.5f}",
            i == 0 ? "" : ",", labels12[i], rms, peak);
    }
    snprintf(json + offset, 1024 - offset, "]}");
    return json;
}

// Returns a malloc'd JSON string: [{"uid":"...","name":"...","isDefault":true}, ...]
// Caller must pass the pointer to free_audio_devices_json when done.
char* audio_list_output_devices(void) {
    AudioObjectPropertyAddress hwProp = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 dataSize = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &hwProp, 0, NULL, &dataSize) != noErr) {
        return strdup("[]");
    }

    UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
    AudioDeviceID *deviceIDs = (AudioDeviceID*)malloc(dataSize);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &hwProp, 0, NULL, &dataSize, deviceIDs) != noErr) {
        free(deviceIDs);
        return strdup("[]");
    }

    AudioObjectPropertyAddress defaultProp = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioDeviceID defaultDevice = 0;
    UInt32 sz = sizeof(AudioDeviceID);
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &defaultProp, 0, NULL, &sz, &defaultDevice);

    NSMutableArray *result = [NSMutableArray array];

    for (UInt32 i = 0; i < deviceCount; i++) {
        AudioDeviceID devID = deviceIDs[i];

        // Only include devices with output streams
        AudioObjectPropertyAddress outStreamProp = {
            kAudioDevicePropertyStreams,
            kAudioDevicePropertyScopeOutput,
            kAudioObjectPropertyElementMain
        };
        UInt32 streamSize = 0;
        if (AudioObjectGetPropertyDataSize(devID, &outStreamProp, 0, NULL, &streamSize) != noErr
            || streamSize == 0) {
            continue;
        }

        AudioObjectPropertyAddress uidProp = {
            kAudioDevicePropertyDeviceUID,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        CFStringRef uidRef = NULL;
        UInt32 uidSize = sizeof(CFStringRef);
        if (AudioObjectGetPropertyData(devID, &uidProp, 0, NULL, &uidSize, &uidRef) != noErr || !uidRef) {
            continue;
        }
        NSString *uid = (__bridge_transfer NSString*)uidRef;

        AudioObjectPropertyAddress nameProp = {
            kAudioObjectPropertyName,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        CFStringRef nameRef = NULL;
        UInt32 nameSize = sizeof(CFStringRef);
        NSString *name = @"Unknown Device";
        if (AudioObjectGetPropertyData(devID, &nameProp, 0, NULL, &nameSize, &nameRef) == noErr && nameRef) {
            name = (__bridge_transfer NSString*)nameRef;
        }

        [result addObject:@{
            @"uid": uid,
            @"name": name,
            @"isDefault": @(devID == defaultDevice)
        }];
    }
    free(deviceIDs);

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    if (!jsonData) return strdup("[]");
    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    return strdup([jsonStr UTF8String]);
}

void free_audio_devices_json(char* ptr) {
    if (ptr) free(ptr);
}

int audio_is_headphone_connected(void) {
    AudioObjectPropertyAddress defaultOutputProp = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioDeviceID defaultDevice = 0;
    UInt32 size = sizeof(AudioDeviceID);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &defaultOutputProp, 0, NULL, &size, &defaultDevice) != noErr) {
        return 0;
    }

    AudioObjectPropertyAddress sourceProp = {
        kAudioDevicePropertyDataSource,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    UInt32 source = 0;
    size = sizeof(UInt32);
    if (AudioObjectGetPropertyData(defaultDevice, &sourceProp, 0, NULL, &size, &source) == noErr) {
        if (source == 'hdpn') {
            return 1;
        }
    }

    AudioObjectPropertyAddress transportProp = {
        kAudioDevicePropertyTransportType,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 transportType = 0;
    size = sizeof(UInt32);
    if (AudioObjectGetPropertyData(defaultDevice, &transportProp, 0, NULL, &size, &transportType) == noErr) {
        if (transportType == 'blth') {
            return 1; // Consider Bluetooth as headphones for EQ purposes
        }
    }

    return 0;
}
