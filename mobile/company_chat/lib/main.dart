import 'package:company_chat/app/app.dart';
import 'package:company_chat/core/notifications/push_notifications.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await PushNotifications.initialize();
  runApp(const ProviderScope(child: CompanyChatApp()));
}
