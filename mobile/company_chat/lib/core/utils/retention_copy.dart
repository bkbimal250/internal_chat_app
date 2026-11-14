String? retentionCopy(Map<String, dynamic>? retention) {
  if (retention == null) return null;
  if (retention['legalHold'] == true) {
    return 'This conversation is on legal hold. Messages are not being deleted.';
  }
  final days = (retention['retentionDays'] as num?)?.toInt();
  if (retention['cleanupEnabled'] == true && days != null) {
    return 'Messages older than $days days are removed according to company policy.';
  }
  if (days != null) {
    return 'Company retention is $days days. Automatic deletion is currently off.';
  }
  return null;
}
