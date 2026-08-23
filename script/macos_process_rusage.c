#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <time.h>

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s <pid>\n", argv[0]);
        return 2;
    }

    char *end = NULL;
    errno = 0;
    long parsed = strtol(argv[1], &end, 10);
    if (errno != 0 || end == argv[1] || *end != '\0' || parsed <= 0 || parsed > INT32_MAX) {
        fprintf(stderr, "pid must be a positive 32-bit integer.\n");
        return 2;
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

    printf("{\"monotonicNanoseconds\":\"%" PRIu64
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
    return 0;
}
