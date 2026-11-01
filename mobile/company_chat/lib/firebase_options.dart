import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('Web Firebase options are not configured.');
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError('Firebase is only configured for Android and iOS.');
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyDZAbsApWMglSiBaH8JCSaRk6DJV8YdcJw',
    appId: '1:954738187259:android:8e709b85bc6abbb584895e',
    messagingSenderId: '954738187259',
    projectId: 'companychat-37ccb',
    storageBucket: 'companychat-37ccb.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyA6wHmwnOBYpxG7YpRI7qtpHTmOKRCzW_E',
    appId: '1:954738187259:ios:8139f5b99025d7b484895e',
    messagingSenderId: '954738187259',
    projectId: 'companychat-37ccb',
    storageBucket: 'companychat-37ccb.firebasestorage.app',
    iosBundleId: 'com.companychat.companyChat',
  );
}
