#import <Foundation/Foundation.h>

#import <CommonCrypto/CommonDigest.h>

#include <stdio.h>
#include <string.h>

#ifndef AMBIENT_PREFLIGHT_PRODUCER_REVISION
#error "AMBIENT_PREFLIGHT_PRODUCER_REVISION must bind the reviewed source revision"
#endif

#ifndef AMBIENT_PREFLIGHT_TESTING
#define AMBIENT_PREFLIGHT_TESTING 0
#endif

static NSString *const AmbientContractID = @"base-m4-static-settled-hidden-wakeups-preflight-v1";
static NSString *const AmbientPlanRelativePath = @"fixtures/resource-budgets/v1/base-m4-static-wakeup-qualification-plan.json";
static NSString *const AmbientPlanSHA256 = @"c071f4cd6032d4d961853df8aa3820365d31dd5c369c19edcd56e182d58c0069";

static NSArray<NSString *> *AmbientCheckKeys(void) {
    return @[
        @"planCollectionReady",
        @"candidateArtifactsMatch",
        @"runningExecutableMatches",
        @"nativeArm64",
        @"prohibitedArgumentsAbsent",
        @"freshProcessIdentity",
        @"publicMachineFactsMatch",
        @"acPower",
        @"lowPowerModeOff",
        @"thermalNominal",
        @"persistedAmbientSubsetMatches",
        @"displayFixtureMatches",
    ];
}

static NSArray<NSString *> *AmbientOwnerAttestations(void) {
    return @[
        @"factory-base-machine-configuration",
        @"hdr-off",
        @"fixed-still-applied-to-both-displays",
        @"ambient-windows-hidden",
        @"no-user-interaction-or-transition",
        @"no-competing-controller-or-diagnostic",
    ];
}

static NSDictionary<NSString *, NSString *> *AmbientStopReasons(void) {
    return @{
        @"candidateArtifactsMatch": @"candidate-artifacts-mismatch",
        @"runningExecutableMatches": @"running-executable-mismatch",
        @"nativeArm64": @"non-native-architecture",
        @"prohibitedArgumentsAbsent": @"prohibited-arguments-present",
        @"freshProcessIdentity": @"process-identity-mismatch",
        @"publicMachineFactsMatch": @"public-machine-facts-mismatch",
        @"acPower": @"ac-power-required",
        @"lowPowerModeOff": @"low-power-mode-enabled",
        @"thermalNominal": @"thermal-state-not-nominal",
        @"persistedAmbientSubsetMatches": @"persisted-state-mismatch",
        @"displayFixtureMatches": @"display-fixture-mismatch",
    };
}

static NSDictionary<NSString *, NSNumber *> *AmbientFalseChecks(void) {
    NSMutableDictionary<NSString *, NSNumber *> *checks = [NSMutableDictionary dictionary];
    for (NSString *key in AmbientCheckKeys()) {
        checks[key] = @NO;
    }
    return [checks copy];
}

static BOOL AmbientHasExactKeys(NSDictionary *value, NSArray<NSString *> *keys) {
    if (![value isKindOfClass:[NSDictionary class]] || value.count != keys.count) {
        return NO;
    }
    return [[NSSet setWithArray:value.allKeys] isEqualToSet:[NSSet setWithArray:keys]];
}

static BOOL AmbientMatches(NSString *value, NSString *pattern) {
    if (![value isKindOfClass:[NSString class]]) {
        return NO;
    }
    NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
    NSRange range = NSMakeRange(0, value.length);
    NSTextCheckingResult *match = [expression firstMatchInString:value options:0 range:range];
    return match != nil && NSEqualRanges(match.range, range);
}

static BOOL AmbientValidRevision(NSString *value) {
    return AmbientMatches(value, @"[a-f0-9]{40}") && ![value isEqualToString:[@"0" stringByPaddingToLength:40 withString:@"0" startingAtIndex:0]];
}

static BOOL AmbientValidSHA256(NSString *value) {
    return AmbientMatches(value, @"[a-f0-9]{64}") && ![value isEqualToString:[@"0" stringByPaddingToLength:64 withString:@"0" startingAtIndex:0]];
}

static BOOL AmbientValidCandidate(NSDictionary *candidate) {
    NSArray<NSString *> *keys = @[
        @"version", @"sourceRevision", @"releaseManifestSHA256",
        @"macosArchiveSHA256", @"executableSHA256", @"architecture",
        @"buildConfiguration", @"artifactKind", @"cleanSource",
    ];
    if (!AmbientHasExactKeys(candidate, keys)) {
        return NO;
    }
    NSSet<NSString *> *artifactKinds = [NSSet setWithArray:@[@"unsigned-candidate", @"signed-notarized-candidate"]];
    return AmbientMatches(candidate[@"version"], @"[0-9]{1,5}[.][0-9]{1,5}[.][0-9]{1,5}")
        && AmbientValidRevision(candidate[@"sourceRevision"])
        && AmbientValidSHA256(candidate[@"releaseManifestSHA256"])
        && AmbientValidSHA256(candidate[@"macosArchiveSHA256"])
        && AmbientValidSHA256(candidate[@"executableSHA256"])
        && [candidate[@"architecture"] isEqual:@"arm64"]
        && [candidate[@"buildConfiguration"] isEqual:@"release"]
        && [artifactKinds containsObject:candidate[@"artifactKind"]]
        && [candidate[@"cleanSource"] isEqual:@YES];
}

static BOOL AmbientValidOperatingSystem(NSDictionary *operatingSystem) {
    return AmbientHasExactKeys(operatingSystem, @[@"version", @"build"])
        && AmbientMatches(operatingSystem[@"version"], @"[0-9]{1,2}(?:[.][0-9]{1,2}){1,2}")
        && AmbientMatches(operatingSystem[@"build"], @"[0-9]{2}[A-Z][0-9]{1,4}[a-z]?");
}

static NSDictionary *AmbientBaseResult(NSString *producerRevision) {
    return @{
        @"schemaVersion": @1,
        @"contractId": AmbientContractID,
        @"artifactKind": @"automated-preflight-result",
        @"claimScope": @"automated-preflight-only",
        @"producerRevision": producerRevision,
        @"qualificationPlanSHA256": AmbientPlanSHA256,
        @"remainingOwnerAttestations": AmbientOwnerAttestations(),
    };
}

static NSDictionary *AmbientPrecheckStop(NSString *producerRevision, NSString *reason) {
    NSMutableDictionary *result = [AmbientBaseResult(producerRevision) mutableCopy];
    result[@"candidate"] = [NSNull null];
    result[@"operatingSystem"] = [NSNull null];
    result[@"checks"] = AmbientFalseChecks();
    result[@"status"] = @"stop";
    result[@"stopReason"] = reason;
    return [result copy];
}

static NSDictionary *AmbientHostUnavailableStop(NSString *producerRevision) {
    NSMutableDictionary<NSString *, NSNumber *> *checks = [AmbientFalseChecks() mutableCopy];
    checks[@"planCollectionReady"] = @YES;
    NSMutableDictionary *result = [AmbientBaseResult(producerRevision) mutableCopy];
    result[@"candidate"] = [NSNull null];
    result[@"operatingSystem"] = [NSNull null];
    result[@"checks"] = [checks copy];
    result[@"status"] = @"stop";
    result[@"stopReason"] = @"public-fact-unavailable";
    return [result copy];
}

static NSDictionary *AmbientEvaluateFacts(NSDictionary *facts, NSString *producerRevision) {
    NSArray<NSString *> *factKeys = @[@"candidate", @"operatingSystem", @"checks"];
    if (!AmbientHasExactKeys(facts, factKeys)) {
        return AmbientHostUnavailableStop(producerRevision);
    }

    NSDictionary *candidate = facts[@"candidate"];
    NSDictionary *operatingSystem = facts[@"operatingSystem"];
    NSDictionary *checks = facts[@"checks"];
    if (!AmbientValidCandidate(candidate)
        || !AmbientValidOperatingSystem(operatingSystem)
        || !AmbientHasExactKeys(checks, AmbientCheckKeys())) {
        return AmbientHostUnavailableStop(producerRevision);
    }
    for (NSString *key in AmbientCheckKeys()) {
        if (CFGetTypeID((__bridge CFTypeRef)checks[key]) != CFBooleanGetTypeID()) {
            return AmbientHostUnavailableStop(producerRevision);
        }
    }

    NSMutableDictionary *result = [AmbientBaseResult(producerRevision) mutableCopy];
    result[@"candidate"] = candidate;
    result[@"operatingSystem"] = operatingSystem;
    result[@"checks"] = checks;

    if (![checks[@"planCollectionReady"] boolValue]) {
        return AmbientHostUnavailableStop(producerRevision);
    }
    for (NSString *key in AmbientCheckKeys()) {
        if ([key isEqualToString:@"planCollectionReady"]) {
            continue;
        }
        if (![checks[key] boolValue]) {
            result[@"status"] = @"stop";
            result[@"stopReason"] = AmbientStopReasons()[key];
            return [result copy];
        }
    }

    result[@"status"] = @"pass";
    result[@"stopReason"] = [NSNull null];
    return [result copy];
}

typedef NSDictionary * _Nullable (^AmbientHostFactsProvider)(NSError **error);

static NSDictionary *AmbientRunPreflight(
    NSDictionary *plan,
    BOOL planBindingMatches,
    NSString *producerRevision,
    AmbientHostFactsProvider provider
) {
    if (!planBindingMatches) {
        return AmbientPrecheckStop(producerRevision, @"plan-binding-mismatch");
    }

    id scenario = plan[@"scenario"];
    id fixedStill = [scenario isKindOfClass:[NSDictionary class]]
        ? ((NSDictionary *)scenario)[@"fixedNonPersonalStillSHA256"]
        : nil;
    if (fixedStill == nil || fixedStill == [NSNull null]) {
        return AmbientPrecheckStop(producerRevision, @"plan-not-collection-ready");
    }
    if (!AmbientValidSHA256(fixedStill)) {
        return AmbientPrecheckStop(producerRevision, @"plan-binding-mismatch");
    }

    NSError *error = nil;
    NSDictionary *facts = provider(&error);
    if (facts == nil || error != nil) {
        return AmbientHostUnavailableStop(producerRevision);
    }
    return AmbientEvaluateFacts(facts, producerRevision);
}

static NSString *AmbientSHA256(NSData *data) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH] = {0};
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *result = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
        [result appendFormat:@"%02x", digest[index]];
    }
    return result;
}

static BOOL AmbientEmitResult(NSDictionary *result) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingSortedKeys error:&error];
    if (data == nil || error != nil) {
        fprintf(stderr, "failed to encode the preflight result.\n");
        return NO;
    }
    if (fwrite(data.bytes, 1, data.length, stdout) != data.length
        || fputc('\n', stdout) == EOF
        || fflush(stdout) != 0
        || ferror(stdout)) {
        fprintf(stderr, "failed to write the preflight result.\n");
        return NO;
    }
    return YES;
}

#if AMBIENT_PREFLIGHT_TESTING
static NSDictionary *AmbientSyntheticCandidate(void) {
    return @{
        @"version": @"0.1.0",
        @"sourceRevision": @"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        @"releaseManifestSHA256": @"1111111111111111111111111111111111111111111111111111111111111111",
        @"macosArchiveSHA256": @"2222222222222222222222222222222222222222222222222222222222222222",
        @"executableSHA256": @"3333333333333333333333333333333333333333333333333333333333333333",
        @"architecture": @"arm64",
        @"buildConfiguration": @"release",
        @"artifactKind": @"unsigned-candidate",
        @"cleanSource": @YES,
    };
}

static NSDictionary *AmbientSyntheticFacts(void) {
    NSMutableDictionary<NSString *, NSNumber *> *checks = [NSMutableDictionary dictionary];
    for (NSString *key in AmbientCheckKeys()) {
        checks[key] = @YES;
    }
    return @{
        @"candidate": AmbientSyntheticCandidate(),
        @"operatingSystem": @{@"version": @"15.0", @"build": @"24A1"},
        @"checks": [checks copy],
    };
}

static BOOL AmbientRunSelfTest(NSString *producerRevision) {
    __block NSUInteger callbackCount = 0;
    NSDictionary *currentPlan = @{@"scenario": @{@"fixedNonPersonalStillSHA256": [NSNull null]}};
    NSDictionary *blocked = AmbientRunPreflight(currentPlan, YES, producerRevision, ^NSDictionary *(NSError **error) {
        (void)error;
        callbackCount += 1;
        return AmbientSyntheticFacts();
    });
    if (callbackCount != 0
        || ![blocked[@"status"] isEqual:@"stop"]
        || ![blocked[@"stopReason"] isEqual:@"plan-not-collection-ready"]) {
        fprintf(stderr, "current-plan preflight did not stop before the host callback.\n");
        return NO;
    }

    NSDictionary *readyPlan = @{@"scenario": @{@"fixedNonPersonalStillSHA256": @"4444444444444444444444444444444444444444444444444444444444444444"}};
    NSDictionary *passing = AmbientRunPreflight(readyPlan, YES, producerRevision, ^NSDictionary *(NSError **error) {
        (void)error;
        callbackCount += 1;
        return AmbientSyntheticFacts();
    });
    if (callbackCount != 1 || ![passing[@"status"] isEqual:@"pass"] || passing[@"stopReason"] != [NSNull null]) {
        fprintf(stderr, "synthetic collection-ready facts did not pass: %s.\n", [passing[@"stopReason"] description].UTF8String);
        return NO;
    }
    NSDictionary *unavailable = AmbientRunPreflight(readyPlan, YES, producerRevision, ^NSDictionary *(NSError **error) {
        callbackCount += 1;
        if (error != NULL) {
            *error = [NSError errorWithDomain:@"ProjectAmbientStaticWakeupPreflightTest" code:1 userInfo:nil];
        }
        return nil;
    });
    if (callbackCount != 2
        || ![unavailable[@"status"] isEqual:@"stop"]
        || ![unavailable[@"stopReason"] isEqual:@"public-fact-unavailable"]
        || ![unavailable[@"checks"][@"planCollectionReady"] boolValue]
        || unavailable[@"candidate"] != [NSNull null]
        || unavailable[@"operatingSystem"] != [NSNull null]) {
        fprintf(stderr, "synthetic unavailable host facts did not preserve plan readiness.\n");
        return NO;
    }

    for (NSString *key in AmbientCheckKeys()) {
        if ([key isEqualToString:@"planCollectionReady"]) {
            continue;
        }
        NSMutableDictionary *facts = [AmbientSyntheticFacts() mutableCopy];
        NSMutableDictionary *checks = [facts[@"checks"] mutableCopy];
        checks[key] = @NO;
        facts[@"checks"] = [checks copy];
        NSDictionary *stopped = AmbientEvaluateFacts(facts, producerRevision);
        if (![stopped[@"status"] isEqual:@"stop"]
            || ![stopped[@"stopReason"] isEqual:AmbientStopReasons()[key]]) {
            fprintf(stderr, "synthetic check mismatch did not stop for %s.\n", key.UTF8String);
            return NO;
        }
    }

    for (NSString *key in @[
        @"version", @"sourceRevision", @"releaseManifestSHA256",
        @"macosArchiveSHA256", @"executableSHA256",
    ]) {
        NSMutableDictionary *facts = [AmbientSyntheticFacts() mutableCopy];
        NSMutableDictionary *candidate = [facts[@"candidate"] mutableCopy];
        candidate[key] = @"";
        facts[@"candidate"] = [candidate copy];
        NSDictionary *stopped = AmbientEvaluateFacts(facts, producerRevision);
        if (![stopped[@"status"] isEqual:@"stop"]
            || ![stopped[@"stopReason"] isEqual:@"public-fact-unavailable"]
            || ![stopped[@"checks"][@"planCollectionReady"] boolValue]) {
            fprintf(stderr, "empty synthetic candidate field did not stop for %s.\n", key.UTF8String);
            return NO;
        }
    }
    for (NSString *key in @[@"version", @"build"]) {
        NSMutableDictionary *facts = [AmbientSyntheticFacts() mutableCopy];
        NSMutableDictionary *operatingSystem = [facts[@"operatingSystem"] mutableCopy];
        operatingSystem[key] = @"";
        facts[@"operatingSystem"] = [operatingSystem copy];
        NSDictionary *stopped = AmbientEvaluateFacts(facts, producerRevision);
        if (![stopped[@"status"] isEqual:@"stop"]
            || ![stopped[@"stopReason"] isEqual:@"public-fact-unavailable"]
            || ![stopped[@"checks"][@"planCollectionReady"] boolValue]) {
            fprintf(stderr, "empty synthetic operating-system field did not stop for %s.\n", key.UTF8String);
            return NO;
        }
    }
    for (NSString *value in @[@"C02Z91ABCDEF", @"24A12345", @"123.0"]) {
        NSMutableDictionary *facts = [AmbientSyntheticFacts() mutableCopy];
        NSMutableDictionary *operatingSystem = [facts[@"operatingSystem"] mutableCopy];
        if ([value containsString:@"."]) {
            operatingSystem[@"version"] = value;
        } else {
            operatingSystem[@"build"] = value;
        }
        facts[@"operatingSystem"] = [operatingSystem copy];
        NSDictionary *stopped = AmbientEvaluateFacts(facts, producerRevision);
        if (![stopped[@"status"] isEqual:@"stop"]
            || ![stopped[@"stopReason"] isEqual:@"public-fact-unavailable"]
            || ![stopped[@"checks"][@"planCollectionReady"] boolValue]) {
            fprintf(stderr, "privacy-shaped synthetic operating-system field did not stop.\n");
            return NO;
        }
    }

    NSMutableDictionary *extraFacts = [AmbientSyntheticFacts() mutableCopy];
    extraFacts[@"pid"] = @1;
    NSDictionary *privacyStopped = AmbientEvaluateFacts(extraFacts, producerRevision);
    if (![privacyStopped[@"status"] isEqual:@"stop"]
        || ![privacyStopped[@"stopReason"] isEqual:@"public-fact-unavailable"]
        || ![privacyStopped[@"checks"][@"planCollectionReady"] boolValue]) {
        fprintf(stderr, "synthetic privacy-field injection did not stop.\n");
        return NO;
    }
    return YES;
}
#endif

static NSDictionary *AmbientUnavailableHostFacts(NSError **error) {
    if (error != NULL) {
        *error = [NSError errorWithDomain:@"ProjectAmbientStaticWakeupPreflight"
                                     code:1
                                 userInfo:@{NSLocalizedDescriptionKey: @"collection-ready host adapters are not active"}];
    }
    return nil;
}

int main(int argc, const char *argv[]) {
    (void)argv;
    @autoreleasepool {
        NSString *producerRevision = @AMBIENT_PREFLIGHT_PRODUCER_REVISION;
        if (!AmbientValidRevision(producerRevision)) {
            fprintf(stderr, "the preflight producer revision is invalid.\n");
            return 2;
        }

#if AMBIENT_PREFLIGHT_TESTING
        if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
            if (!AmbientRunSelfTest(producerRevision)) {
                fprintf(stderr, "static-wakeup preflight native self-test failed.\n");
                return 1;
            }
            printf("static-wakeup preflight native self-test passed; current-plan host callbacks: 0.\n");
            return 0;
        }
#endif

        if (argc != 1) {
            fprintf(stderr, "the static-wakeup preflight accepts no production arguments.\n");
            return 2;
        }

        NSString *planPath = [[[NSFileManager defaultManager] currentDirectoryPath]
            stringByAppendingPathComponent:AmbientPlanRelativePath];
        NSError *readError = nil;
        NSData *planData = [NSData dataWithContentsOfFile:planPath options:NSDataReadingMappedIfSafe error:&readError];
        if (planData == nil || readError != nil) {
            return AmbientEmitResult(AmbientPrecheckStop(producerRevision, @"plan-binding-mismatch")) ? 1 : 2;
        }
        NSString *digest = AmbientSHA256(planData);
        NSError *parseError = nil;
        NSDictionary *plan = [NSJSONSerialization JSONObjectWithData:planData options:0 error:&parseError];
        BOOL parsedPlan = [plan isKindOfClass:[NSDictionary class]] && parseError == nil;
        NSDictionary *result = AmbientRunPreflight(
            parsedPlan ? plan : @{},
            parsedPlan && [digest isEqualToString:AmbientPlanSHA256],
            producerRevision,
            ^NSDictionary *(NSError **error) {
                return AmbientUnavailableHostFacts(error);
            }
        );
        if (!AmbientEmitResult(result)) {
            return 2;
        }
        return [result[@"status"] isEqual:@"pass"] ? 0 : 1;
    }
}
