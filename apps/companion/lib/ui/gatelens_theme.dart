import 'package:flutter/material.dart';

/// GateLens demo palette.
abstract final class GateLensColors {
  static const primary = Color(0xff66c3c1);
  static const mint = Color(0xffb4e6e4);
  static const background = Color(0xff323333);
  static const surface = Color(0xff424141);
  static const text = Color(0xfff8f8f8);
  static const muted = Color(0xffa8b3b2);
  static const error = Color(0xffe57373);
}

final gateLensTheme = ThemeData(
  useMaterial3: true,
  colorScheme: const ColorScheme.dark(
    primary: GateLensColors.primary,
    onPrimary: Color(0xff173a38),
    secondary: GateLensColors.mint,
    onSecondary: Color(0xff173a38),
    surface: GateLensColors.surface,
    onSurface: GateLensColors.text,
    error: GateLensColors.error,
  ),
  scaffoldBackgroundColor: GateLensColors.background,
  appBarTheme: const AppBarTheme(
    backgroundColor: GateLensColors.background,
    foregroundColor: GateLensColors.text,
    elevation: 0,
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: GateLensColors.mint,
      foregroundColor: const Color(0xff173a38),
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
    ),
  ),
  cardTheme: CardThemeData(
    color: GateLensColors.surface,
    elevation: 0,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
  ),
);
