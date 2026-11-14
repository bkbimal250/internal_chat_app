import 'package:intl/intl.dart';

DateTime? asDate(Object? value) {
  if (value == null) return null;
  if (value is DateTime) return value.toLocal();
  return DateTime.tryParse(value.toString())?.toLocal();
}

String formatClock(Object? value) {
  final date = asDate(value);
  if (date == null) return '';
  return DateFormat('HH:mm').format(date);
}

String formatMessageTime(Object? value) {
  final date = asDate(value);
  if (date == null) return '';
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(date.year, date.month, date.day);
  if (day == today) return DateFormat('HH:mm').format(date);
  if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
  if (today.difference(day).inDays < 7) return DateFormat('EEE').format(date);
  return DateFormat('dd MMM').format(date);
}

String formatDateSeparator(Object? value) {
  final date = asDate(value);
  if (date == null) return '';
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(date.year, date.month, date.day);
  if (day == today) return 'Today';
  if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
  return DateFormat('EEEE, d MMMM yyyy').format(date);
}

bool sameDay(Object? left, Object? right) {
  final a = asDate(left);
  final b = asDate(right);
  if (a == null || b == null) return false;
  return a.year == b.year && a.month == b.month && a.day == b.day;
}
