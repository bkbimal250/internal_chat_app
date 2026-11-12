import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

class MiChatSearchField extends StatelessWidget {
  const MiChatSearchField({
    super.key,
    this.controller,
    this.onChanged,
    this.hint = 'Search',
  });

  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      style: const TextStyle(fontSize: 16, color: AppColors.navy),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: AppColors.slate),
        prefixIcon: const Icon(Icons.search, color: AppColors.slate),
        filled: true,
        fillColor: AppColors.white,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: const BorderSide(color: AppColors.gold, width: 1.4),
        ),
      ),
    );
  }
}
