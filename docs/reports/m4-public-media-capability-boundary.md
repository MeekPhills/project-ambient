# Base-M4 public media capability boundary

**Issue:** [#28](https://github.com/MeekPhills/project-ambient/issues/28)  
**Captured:** 2026-08-23T13:36:35Z  
**Producer revision:** `08c6b09845a218e02b6e8f6f10cba368a203dc59`  
**Qualification:** host capability only — no runtime measurement, M4 certification, or tracker credit

## Method

At the exact producer revision above,
`script/macos_media_capability_probe.m` used only public macOS framework APIs.
It queried `VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)` once and called
`MTLCopyAllDevices()` once to determine whether the host exposed at least one
Metal device. The probe created no decoder or decompression session and created
no Metal command queue, command buffer, observer, timer, player, or media path.
It did not inspect Ambient or any other process.

The probe emits only closed booleans and explicit null runtime fields. It emits
no process identifier, path, media metadata, device name, registry identifier,
hardware serial, host identity, location, credential, or user content. Its
fail-closed validator enforces the exact output shape and source boundary, and
the release aggregate compiles and runs the probe on macOS.

## Exact sanitized output

```json
{"schemaVersion":1,"scope":"host-capability-only","hevcCodecTypeHardwareDecodeSupported":true,"metalDeviceAvailable":true,"decoderSessions":null,"gpuTimeNanoseconds":null,"gpuUtilizationPercent":null,"qualification":"capability-only"}
```

## Interpretation boundary

The observed `true` HEVC result means only that VideoToolbox reports hardware
decode support for the HEVC codec type on this host. It does not establish that
a decoder session was created, that resources remain available, or that a
particular profile, level, resolution, frame rate, HDR mode, or rendition will
be hardware-backed.

The observed `true` Metal result means only that `MTLCopyAllDevices()` exposed
at least one Metal device. The probe submitted no GPU work and measured no GPU
time, utilization, frame pacing, command activity, or downstream compositor
activity.

Project Ambient's current still-background path has no app-owned video
renderer or decoder to instrument. Aerial export can copy video assets, but
this probe neither runs nor measures that path and cannot characterize Aerial,
WindowServer, or other system activity. One logical player object would not be
a valid decoder-session count in any case.

Accordingly, decoder sessions, GPU time, GPU utilization, and frame pacing
remain null and `unmeasured`. The existing resource fixture and canonical
tracker are unchanged: issue #28 remains open, schema v3 remains active, and
readiness remains 20/100.
