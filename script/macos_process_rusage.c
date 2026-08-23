#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>

static int process_matches_expected_name(int pid, const char *expected_name) {
    char executable_name[PROC_PIDPATHINFO_MAXSIZE] = {0};
    int name_length = proc_name(pid, executable_name, sizeof(executable_name));
    if (name_length <= 0 || (size_t)name_length >= sizeof(executable_name)) {
        fprintf(stderr, "process executable identity is unavailable.\n");
        return 0;
    }

    if (strcmp(executable_name, expected_name) != 0) {
        fprintf(stderr, "process executable does not match the expected name.\n");
        return 0;
    }
    return 1;
}

static int process_start_unix_microseconds(int pid, uint64_t *result) {
    struct proc_bsdinfo info = {0};
    int bytes = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, (int)sizeof(info));
    if (bytes != (int)sizeof(info) || info.pbi_pid != (uint32_t)pid || info.pbi_start_tvusec >= UINT64_C(1000000)) {
        fprintf(stderr, "process start identity is unavailable.\n");
        return 0;
    }
    if (info.pbi_start_tvsec > (UINT64_MAX - info.pbi_start_tvusec) / UINT64_C(1000000)) {
        fprintf(stderr, "process start identity is outside uint64 range.\n");
        return 0;
    }
    *result = info.pbi_start_tvsec * UINT64_C(1000000) + info.pbi_start_tvusec;
    if (*result == 0) {
        fprintf(stderr, "process start identity is invalid.\n");
        return 0;
    }
    return 1;
}

int main(int argc, char **argv) {
    if (argc < 2 || argc > 3) {
        fprintf(stderr, "usage: %s <pid> [expected-executable-name]\n", argv[0]);
        return 2;
    }

    char *end = NULL;
    errno = 0;
    long parsed = strtol(argv[1], &end, 10);
    if (errno != 0 || end == argv[1] || *end != '\0' || parsed <= 0 || parsed > INT32_MAX) {
        fprintf(stderr, "pid must be a positive 32-bit integer.\n");
        return 2;
    }

    const char *expected_name = argc == 3 ? argv[2] : NULL;
    if (expected_name != NULL && (expected_name[0] == '\0' || strchr(expected_name, '/') != NULL)) {
        fprintf(stderr, "expected executable name must be a non-empty basename.\n");
        return 2;
    }
    if (expected_name != NULL && !process_matches_expected_name((int)parsed, expected_name)) {
        return 1;
    }

    uint64_t process_start_before = 0;
    if (!process_start_unix_microseconds((int)parsed, &process_start_before)) {
        return 1;
    }

    struct rusage_info_v3 usage = {0};
    if (proc_pid_rusage((int)parsed, RUSAGE_INFO_V3, (rusage_info_t *)&usage) != 0) {
        perror("proc_pid_rusage");
        return 1;
    }

    struct timespec wall_now = {0};
    if (clock_gettime(CLOCK_REALTIME, &wall_now) != 0) {
        perror("clock_gettime");
        return 1;
    }
    if (wall_now.tv_sec < 0 || (uint64_t)wall_now.tv_sec > (UINT64_MAX - (uint64_t)wall_now.tv_nsec / UINT64_C(1000)) / UINT64_C(1000000)) {
        fprintf(stderr, "wall-clock sample is outside uint64 range.\n");
        return 1;
    }
    uint64_t wall_clock_us = (uint64_t)wall_now.tv_sec * UINT64_C(1000000) + (uint64_t)wall_now.tv_nsec / UINT64_C(1000);

    struct timespec monotonic_now = {0};
    if (clock_gettime(CLOCK_MONOTONIC_RAW, &monotonic_now) != 0) {
        perror("clock_gettime");
        return 1;
    }
    if (monotonic_now.tv_sec < 0 || (uint64_t)monotonic_now.tv_sec > (UINT64_MAX - (uint64_t)monotonic_now.tv_nsec) / UINT64_C(1000000000)) {
        fprintf(stderr, "monotonic sample is outside uint64 range.\n");
        return 1;
    }
    uint64_t monotonic_ns = (uint64_t)monotonic_now.tv_sec * UINT64_C(1000000000) + (uint64_t)monotonic_now.tv_nsec;

    uint64_t process_start_after = 0;
    if (!process_start_unix_microseconds((int)parsed, &process_start_after) || process_start_after != process_start_before) {
        fprintf(stderr, "process identity changed during the snapshot.\n");
        return 1;
    }

    if (expected_name != NULL && !process_matches_expected_name((int)parsed, expected_name)) {
        return 1;
    }

    int output_result = printf("{\"monotonicNanoseconds\":\"%" PRIu64
                               "\",\"wallClockUnixMicroseconds\":\"%" PRIu64
                               "\",\"processStartAbsoluteTime\":\"%" PRIu64
                               "\",\"processStartUnixMicroseconds\":\"%" PRIu64
                               "\",\"physicalFootprintBytes\":\"%" PRIu64
                               "\",\"packageIdleWakeups\":\"%" PRIu64
                               "\",\"interruptWakeups\":\"%" PRIu64
                               "\",\"diskReadBytes\":\"%" PRIu64
                               "\",\"diskWrittenBytes\":\"%" PRIu64 "\"}\n",
                               monotonic_ns,
                               wall_clock_us,
                               usage.ri_proc_start_abstime,
                               process_start_before,
                               usage.ri_phys_footprint,
                               usage.ri_pkg_idle_wkups,
                               usage.ri_interrupt_wkups,
                               usage.ri_diskio_bytesread,
                               usage.ri_diskio_byteswritten);
    if (output_result < 0 || fflush(stdout) != 0 || ferror(stdout)) {
        fprintf(stderr, "failed to write the process-rusage snapshot.\n");
        return 1;
    }
    return 0;
}
