import 'package:flutter/material.dart';

class AppColors {
  const AppColors._();

  static const navy = Color(0xFF171E25);
  static const ivory = Color(0xFFFAF6EF);
  static const gold = Color(0xFFC6A04B);
  static const goldDeep = Color(0xFFA9863A);
  static const goldForeground = Color(0xFF171E25);
  static const white = Color(0xFFFFFFFF);
  static const slate = Color(0xFF66717D);
  static const border = Color(0xFFE6E0D6);
  static const surface = Color(0xFFF5F4F0);
  static const error = Color(0xFFD64545);
  static const success = Color(0xFF24865A);

  static const background = ivory;
  static const foreground = navy;
  static const card = white;
  static const muted = surface;
  static const mutedForeground = slate;
  static const goldSoft = Color(0xFFF4E7C8);
  static const sidebar = navy;
  static const sidebarForeground = ivory;
  static const sidebarAccent = Color(0xFF232C35);
  static const incoming = white;
  static const outgoing = goldSoft;
  static const unread = gold;
  static const destructive = error;
  static const wallpaper = Color(0xFFF3EEE4);
  static const selection = Color(0x33C6A04B);
  static const composer = white;
}

class AppSpacing {
  const AppSpacing._();

  static const xxs = 4.0;
  static const xs = 8.0;
  static const sm = 12.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xxl = 40.0;

  static const page = 20.0;
  static const radiusSm = 10.0;
  static const radius = 14.0;
  static const radiusLg = 20.0;
  static const buttonHeight = 52.0;
  static const inputHeight = 52.0;
  static const touchTarget = 48.0;
  static const avatar = 48.0;
  static const listRow = 76.0;
}

class AppBreakpoints {
  const AppBreakpoints._();

  static const compact = 600.0;
  static const expanded = 840.0;

  static double widthOf(BuildContext context) => MediaQuery.sizeOf(context).width;

  static bool isCompact(BuildContext context) => widthOf(context) < compact;

  static bool isMedium(BuildContext context) {
    final width = widthOf(context);
    return width >= compact && width < expanded;
  }

  static bool isExpanded(BuildContext context) => widthOf(context) >= expanded;

  static double paneWidth(BuildContext context) {
    final width = widthOf(context);
    if (width >= 1100) return 400;
    if (width >= expanded) return 360;
    return width;
  }

  static EdgeInsets pagePadding(BuildContext context) {
    final width = widthOf(context);
    final horizontal = width >= expanded ? 28.0 : width >= compact ? 22.0 : AppSpacing.page;
    return EdgeInsets.symmetric(horizontal: horizontal, vertical: AppSpacing.md);
  }
}
