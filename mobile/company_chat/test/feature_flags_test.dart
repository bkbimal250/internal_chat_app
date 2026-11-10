import 'package:company_chat/core/config/feature_flags.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('feature flags default off until health/ready says otherwise', () {
    expect(const FeatureFlags().chatAttachmentsEnabled, isFalse);
    expect(const FeatureFlags().voiceCallingEnabled, isFalse);
    expect(
      FeatureFlags.fromReady({'attachmentsEnabled': true, 'callsEnabled': false}).chatAttachmentsEnabled,
      isTrue,
    );
    expect(
      FeatureFlags.fromReady({'attachmentsEnabled': true, 'callsEnabled': false}).voiceCallingEnabled,
      isFalse,
    );
    expect(
      FeatureFlags.fromReady({'attachmentsEnabled': false, 'callsEnabled': true}).chatAttachmentsEnabled,
      isFalse,
    );
    expect(FeatureFlags.fromReady(null).chatAttachmentsEnabled, isFalse);
    expect(FeatureFlags.fromReady(null).voiceCallingEnabled, isFalse);
  });
}
