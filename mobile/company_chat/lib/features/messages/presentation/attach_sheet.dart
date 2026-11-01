import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:flutter/material.dart';

class AttachChoice {
  const AttachChoice(this.kind, this.quality);
  final String kind;
  final MediaQuality quality;
}

Future<AttachChoice?> showAttachSheet(BuildContext context, {MediaQuality quality = MediaQuality.auto}) {
  var selected = quality;
  return showModalBottomSheet<AttachChoice>(
    context: context,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) {
      return SafeArea(
        child: StatefulBuilder(
          builder: (context, setSheet) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 36,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(99)),
                  ),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final item in MediaQuality.values)
                        ChoiceChip(
                          label: Text(switch (item) {
                            MediaQuality.auto => 'Auto',
                            MediaQuality.high => 'High',
                            MediaQuality.dataSaver => 'Saver',
                            MediaQuality.original => 'Original',
                          }),
                          selected: selected == item,
                          onSelected: (_) => setSheet(() => selected = item),
                        ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _AttachTile(
                        color: const Color(0xFF5B6B8C),
                        icon: Icons.insert_drive_file_outlined,
                        label: 'Document',
                        onTap: () => Navigator.pop(context, AttachChoice('document', selected)),
                      ),
                      _AttachTile(
                        color: const Color(0xFFC2413B),
                        icon: Icons.photo_library_outlined,
                        label: 'Photos &\nvideos',
                        onTap: () => Navigator.pop(context, AttachChoice('media', selected)),
                      ),
                      _AttachTile(
                        color: const Color(0xFFC2413B),
                        icon: Icons.photo_camera_outlined,
                        label: 'Camera',
                        onTap: () => Navigator.pop(context, AttachChoice('camera', selected)),
                      ),
                      _AttachTile(
                        color: const Color(0xFF8B5E3C),
                        icon: Icons.headphones_outlined,
                        label: 'Audio',
                        onTap: () => Navigator.pop(context, AttachChoice('audio', selected)),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        ),
      );
    },
  );
}

Future<String?> showCameraCaptureSheet(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined, color: AppColors.gold),
            title: const Text('Photo'),
            onTap: () => Navigator.pop(context, 'photo'),
          ),
          ListTile(
            leading: const Icon(Icons.videocam_outlined, color: AppColors.gold),
            title: const Text('Video'),
            subtitle: const Text('Includes recorded audio'),
            onTap: () => Navigator.pop(context, 'video'),
          ),
        ],
      ),
    ),
  );
}

class _AttachTile extends StatelessWidget {
  const _AttachTile({required this.color, required this.icon, required this.label, required this.onTap});

  final Color color;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(
        width: 72,
        child: Column(
          children: [
            CircleAvatar(
              radius: 26,
              backgroundColor: color,
              child: Icon(icon, color: Colors.white),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.foreground),
            ),
          ],
        ),
      ),
    );
  }
}
