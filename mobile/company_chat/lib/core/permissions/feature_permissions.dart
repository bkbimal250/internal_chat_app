import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

class FeaturePermissions {
  static Future<bool> request(
    BuildContext context, {
    required Permission permission,
    required String title,
    required String message,
  }) async {
    final status = await permission.status;
    if (status.isGranted || status.isLimited) return true;
    if (status.isPermanentlyDenied) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$title is turned off for MiChat.')));
      }
      return false;
    }
    if (!context.mounted) return false;
    final proceed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue')),
        ],
      ),
    );
    if (proceed != true) return false;
    final next = await permission.request();
    return next.isGranted || next.isLimited;
  }

  static Future<bool> camera(BuildContext context) {
    return request(
      context,
      permission: Permission.camera,
      title: 'Camera',
      message: 'MiChat uses the camera only when you take a photo or video to send.',
    );
  }

  static Future<bool> microphone(BuildContext context) {
    return request(
      context,
      permission: Permission.microphone,
      title: 'Microphone',
      message: 'MiChat uses the microphone only for voice calls and voice notes you start.',
    );
  }

  static Future<bool> notifications() async {
    final status = await Permission.notification.status;
    if (status.isGranted) return true;
    final next = await Permission.notification.request();
    return next.isGranted;
  }
}
