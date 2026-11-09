import 'package:company_chat/app/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class FeatureFlags {
  const FeatureFlags({
    this.chatAttachmentsEnabled = false,
    this.voiceCallingEnabled = false,
  });

  final bool chatAttachmentsEnabled;
  final bool voiceCallingEnabled;

  FeatureFlags copyWith({bool? chatAttachmentsEnabled, bool? voiceCallingEnabled}) {
    return FeatureFlags(
      chatAttachmentsEnabled: chatAttachmentsEnabled ?? this.chatAttachmentsEnabled,
      voiceCallingEnabled: voiceCallingEnabled ?? this.voiceCallingEnabled,
    );
  }

  factory FeatureFlags.fromReady(Map<String, dynamic>? data) {
    return FeatureFlags(
      chatAttachmentsEnabled: data?['attachmentsEnabled'] == true,
      voiceCallingEnabled: data?['callsEnabled'] == true,
    );
  }
}

class FeatureFlagsController extends StateNotifier<FeatureFlags> {
  FeatureFlagsController(this._ref) : super(const FeatureFlags());

  final Ref _ref;

  Future<void> refresh() async {
    try {
      final data = await _ref.read(apiClientProvider).get<Map<String, dynamic>>('/health/ready');
      if (!mounted) return;
      state = FeatureFlags.fromReady(data);
    } catch (_) {
      if (!mounted) return;
      state = const FeatureFlags();
    }
  }
}

final featureFlagsProvider = StateNotifierProvider<FeatureFlagsController, FeatureFlags>((ref) {
  return FeatureFlagsController(ref);
});
