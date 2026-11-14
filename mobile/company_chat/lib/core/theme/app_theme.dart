import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class AppTheme {
  const AppTheme._();

  static ThemeData light() {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.gold,
      onPrimary: AppColors.goldForeground,
      secondary: AppColors.navy,
      onSecondary: AppColors.ivory,
      error: AppColors.error,
      onError: AppColors.white,
      surface: AppColors.card,
      onSurface: AppColors.navy,
      outline: AppColors.border,
      surfaceContainerHighest: AppColors.surface,
    );

    const textTheme = TextTheme(
      displaySmall: TextStyle(fontSize: 32, height: 1.15, fontWeight: FontWeight.w700, color: AppColors.navy, letterSpacing: -0.4),
      headlineMedium: TextStyle(fontSize: 26, height: 1.2, fontWeight: FontWeight.w700, color: AppColors.navy, letterSpacing: -0.3),
      headlineSmall: TextStyle(fontSize: 22, height: 1.25, fontWeight: FontWeight.w700, color: AppColors.navy),
      titleLarge: TextStyle(fontSize: 18, height: 1.3, fontWeight: FontWeight.w700, color: AppColors.navy),
      titleMedium: TextStyle(fontSize: 16, height: 1.35, fontWeight: FontWeight.w600, color: AppColors.navy),
      titleSmall: TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w600, color: AppColors.navy),
      bodyLarge: TextStyle(fontSize: 16, height: 1.45, fontWeight: FontWeight.w400, color: AppColors.navy),
      bodyMedium: TextStyle(fontSize: 14, height: 1.45, fontWeight: FontWeight.w400, color: AppColors.navy),
      bodySmall: TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w400, color: AppColors.slate),
      labelLarge: TextStyle(fontSize: 15, height: 1.2, fontWeight: FontWeight.w600, color: AppColors.navy),
      labelMedium: TextStyle(fontSize: 12, height: 1.2, fontWeight: FontWeight.w600, color: AppColors.slate),
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.ivory,
      canvasColor: AppColors.ivory,
      dividerColor: AppColors.border,
      textTheme: textTheme,
      splashFactory: InkSparkle.splashFactory,
    );

    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.navy,
        foregroundColor: AppColors.ivory,
        elevation: 0,
        centerTitle: false,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.ivory),
      ),
      cardTheme: CardThemeData(
        color: AppColors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radius),
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        hintStyle: const TextStyle(color: AppColors.slate),
        labelStyle: const TextStyle(color: AppColors.slate),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusSm)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: const BorderSide(color: AppColors.gold, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          borderSide: const BorderSide(color: AppColors.error),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.gold,
          foregroundColor: AppColors.navy,
          disabledBackgroundColor: AppColors.gold.withValues(alpha: 0.45),
          minimumSize: const Size.fromHeight(AppSpacing.buttonHeight),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusSm)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.slate,
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          minimumSize: const Size(AppSpacing.touchTarget, AppSpacing.touchTarget),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.navy,
        indicatorColor: AppColors.sidebarAccent,
        height: 68,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(color: selected ? AppColors.gold : AppColors.ivory.withValues(alpha: 0.72));
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            color: selected ? AppColors.gold : AppColors.ivory.withValues(alpha: 0.72),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          );
        }),
      ),
      navigationRailTheme: const NavigationRailThemeData(
        backgroundColor: AppColors.navy,
        selectedIconTheme: IconThemeData(color: AppColors.gold),
        unselectedIconTheme: IconThemeData(color: AppColors.ivory),
        selectedLabelTextStyle: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w600),
        unselectedLabelTextStyle: TextStyle(color: AppColors.ivory),
        indicatorColor: AppColors.sidebarAccent,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.navy,
        contentTextStyle: const TextStyle(color: AppColors.ivory),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusSm)),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.gold,
        foregroundColor: AppColors.navy,
        elevation: 2,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppSpacing.radiusLg)),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.white,
        selectedColor: AppColors.goldSoft,
        disabledColor: AppColors.surface,
        labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.navy),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(99),
          side: const BorderSide(color: AppColors.border),
        ),
        side: const BorderSide(color: AppColors.border),
        showCheckmark: false,
      ),
      dividerTheme: const DividerThemeData(color: AppColors.border, space: 1, thickness: 1),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.gold),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.selected) ? AppColors.gold : AppColors.slate;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.selected) ? AppColors.goldSoft : AppColors.border;
        }),
      ),
    );
  }
}
