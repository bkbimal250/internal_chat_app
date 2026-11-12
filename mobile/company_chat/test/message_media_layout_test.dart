import 'package:company_chat/core/theme/app_theme.dart';
import 'package:company_chat/features/messages/presentation/widgets/message_bubble.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _pumpAt(WidgetTester tester, Size size, Widget child, {double textScale = 1}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MediaQuery(
      data: MediaQueryData(size: size, textScaler: TextScaler.linear(textScale)),
      child: child,
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('normal message bubbles do not show persistent action overlays', (tester) async {
    await _pumpAt(
      tester,
      const Size(360, 740),
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: MessageBubble(
            message: {
              'id': 'm1',
              'senderId': 'me',
              'content': 'Hello from MiChat',
              'messageType': 'text',
              'createdAt': DateTime.now().toUtc().toIso8601String(),
            },
            previous: null,
            currentUserId: 'me',
            isGroup: false,
            members: const [],
            onReply: () {},
            onLongPress: () {},
          ),
        ),
      ),
    );
    expect(find.text('Hello from MiChat'), findsOneWidget);
    expect(find.text('Reply'), findsNothing);
    expect(find.text('Forward'), findsNothing);
    expect(find.text('Hide'), findsNothing);
  });

  testWidgets('long filenames stay inside compact attachment cards', (tester) async {
    const longName = 'MiChat_very_long_unbroken_filename_that_should_ellipsis_instead_of_covering_the_chat.pdf';
    await _pumpAt(
      tester,
      const Size(320, 568),
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: Center(
              child: AttachmentThumb(
                attachment: {
                  'kind': 'file',
                  'displayName': longName,
                  'sizeBytes': 2048,
                },
              ),
            ),
          ),
        ),
      ),
      textScale: 1.4,
    );
    expect(tester.takeException(), isNull);
    final named = tester.widgetList<Text>(find.byType(Text)).where((row) => row.data == longName);
    expect(named, isNotEmpty);
    expect(named.first.maxLines, 2);
    expect(named.first.overflow, TextOverflow.ellipsis);
    expect(tester.getSize(find.byType(AttachmentThumb)).width, lessThanOrEqualTo(240));
  });

  testWidgets('image thumbs stay bounded and video list items are placeholders', (tester) async {
    await _pumpAt(
      tester,
      const Size(360, 740),
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                AttachmentThumb(attachment: {'kind': 'image'}),
                AttachmentThumb(attachment: {'kind': 'video'}),
                AttachmentThumb(attachment: {'kind': 'audio', 'displayName': 'voice-note.m4a', 'sizeBytes': 12000}),
              ],
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.byIcon(Icons.play_arrow), findsOneWidget);
    expect(find.byType(SizedBox).evaluate().any((node) {
      final box = node.widget as SizedBox;
      return box.width == 220 && box.height == 180;
    }), isTrue);
    expect(find.text('voice-note.m4a'), findsOneWidget);
  });
}
