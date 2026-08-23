#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <VideoToolbox/VideoToolbox.h>

#include <stdio.h>

int main(int argc, const char *argv[]) {
    (void)argv;
    if (argc != 1) {
        fprintf(stderr, "the media capability probe accepts no arguments.\n");
        return 2;
    }

    @autoreleasepool {
        Boolean hevc_supported = VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC);
        NSArray<id<MTLDevice>> *devices = MTLCopyAllDevices();
        BOOL metal_available = devices.count > 0;

        int output_result = printf(
            "{\"schemaVersion\":1,"
            "\"scope\":\"host-capability-only\","
            "\"hevcCodecTypeHardwareDecodeSupported\":%s,"
            "\"metalDeviceAvailable\":%s,"
            "\"decoderSessions\":null,"
            "\"gpuTimeNanoseconds\":null,"
            "\"gpuUtilizationPercent\":null,"
            "\"qualification\":\"capability-only\"}\n",
            hevc_supported ? "true" : "false",
            metal_available ? "true" : "false"
        );
        if (output_result < 0 || fflush(stdout) != 0 || ferror(stdout)) {
            fprintf(stderr, "failed to write the media capability result.\n");
            return 1;
        }
    }

    return 0;
}
