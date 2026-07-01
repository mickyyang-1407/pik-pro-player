fn main() {
    #[cfg(target_os = "macos")]
    {
        std::env::set_var("MACOSX_DEPLOYMENT_TARGET", "11.0");

        cc::Build::new()
            .file("src/player/atmos_wrapper.m")
            .flag("-fobjc-arc")
            .compile("atmos_wrapper");

        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=MediaToolbox");
        println!("cargo:rustc-link-lib=framework=Accelerate");
    }

    tauri_build::build()
}
