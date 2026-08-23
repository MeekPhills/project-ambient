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

    struct rusage_info_v3 usage = {0};
    if (proc_pid_rusage((int)parsed, RUSAGE_INFO_V3, (rusage_info_t *)&usage) != 0) {
        perror("proc_pid_rusage");
        return 1;
    }

    struct timespec now = {0};
    if (clock_gettime(CLOCK_MONOTONIC_RAW, &now) != 0) {
        perror("clock_gettime");
        return 1;
    }
    uint64_t monotonic_ns = (uint64_t)now.tv_sec * UINT64_C(1000000000) + (uint64_t)now.tv_nsec;

    if (expected_name != NULL && !process_matches_expected_name((int)parsed, expected_name)) {
        return 1;
    }

    int output_result = printf("{\"monotonicNanoseconds\":\"%" PRIu64
                               "\",\"processStartAbsoluteTime\":\"%" PRIu64
                               "\",\"packageIdleWakeups\":\"%" PRIu64
                               "\",\"interruptWakeups\":\"%" PRIu64
                               "\",\"diskReadBytes\":\"%" PRIu64
                               "\",\"diskWrittenBytes\":\"%" PRIu64 "\"}\n",
                               monotonic_ns,
                               usage.ri_proc_start_abstime,
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
