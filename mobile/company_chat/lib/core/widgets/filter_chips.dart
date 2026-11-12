import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

class FilterOption {
  const FilterOption(this.id, this.label);

  final String id;
  final String label;
}

class MiChatFilterChips extends StatelessWidget {
  const MiChatFilterChips({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final List<FilterOption> options;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: options.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final item = options[index];
          final active = selected == item.id;
          return Material(
            color: active ? AppColors.goldSoft : AppColors.white,
            shape: StadiumBorder(
              side: BorderSide(color: active ? AppColors.gold : AppColors.border),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: () => onSelected(item.id),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 36, minWidth: 64),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Center(
                    child: Text(
                      item.label,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                        color: AppColors.navy,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
