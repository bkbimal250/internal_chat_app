import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.sidebar,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 28,
              backgroundColor: AppColors.sidebarAccent,
              child: Text('CC', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w700)),
            ),
            SizedBox(height: 16),
            Text('Company Chat', style: TextStyle(color: AppColors.sidebarForeground, fontSize: 20)),
            SizedBox(height: 12),
            CircularProgressIndicator(color: AppColors.gold),
          ],
        ),
      ),
    );
  }
}
