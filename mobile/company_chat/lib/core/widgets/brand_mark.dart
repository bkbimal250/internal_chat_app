import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.inverted = false, this.compact = false});

  final bool inverted;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final titleColor = inverted ? AppColors.ivory : AppColors.navy;
    final subtitleColor = inverted ? AppColors.ivory.withValues(alpha: 0.7) : AppColors.slate;
    final size = compact ? 36.0 : 44.0;
    return Row(
      children: [
        Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: inverted ? AppColors.sidebarAccent : AppColors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: inverted ? AppColors.gold.withValues(alpha: 0.35) : AppColors.border),
          ),
          child: Text(
            'M',
            style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w700, fontSize: compact ? 16 : 18),
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('MiChat', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: compact ? 16 : 20, fontWeight: FontWeight.w700, color: titleColor)),
              Text('Internal workspace', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: subtitleColor)),
            ],
          ),
        ),
      ],
    );
  }
}
