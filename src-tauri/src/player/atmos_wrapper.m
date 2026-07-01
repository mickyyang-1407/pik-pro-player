#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/CoreAudio.h>
#import <MediaToolbox/MediaToolbox.h>
#import <Accelerate/Accelerate.h>
#import <objc/runtime.h>
#import <stdlib.h>
#import <string.h>

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
