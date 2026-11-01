import 'dart:io';

String devicePlatform() {
  if (Platform.isIOS) return 'ios';
  if (Platform.isAndroid) return 'android';
  return 'android';
}

String deviceName() {
  if (Platform.isIOS) return 'iPhone';
  if (Platform.isAndroid) return 'Android';
  return 'Mobile';
}
