import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/theme/app_theme.dart';
import 'package:company_chat/core/widgets/conversation_tile.dart';
import 'package:company_chat/core/widgets/empty_state.dart';
import 'package:company_chat/core/widgets/filter_chips.dart';
import 'package:company_chat/core/widgets/michat_controls.dart';
import 'package:company_chat/features/auth/presentation/login_screen.dart';
import 'package:company_chat/features/messages/presentation/widgets/message_bubble.dart';
import 'package:company_chat/features/messages/presentation/widgets/reply_preview.dart';
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
  testWidgets('OTP boxes accept a pasted 6-digit code', (tester) async {
    final controller = TextEditingController();
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: MiChatOtpInput(controller: controller)),
      ),
    );
    await tester.enterText(find.byType(TextField).first, '123456');
    await tester.pump();
    expect(controller.text, '123456');
  });

  testWidgets('login survives large text scaling', (tester) async {
    await _pumpAt(
      tester,
      const Size(375, 812),
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const LoginScreen(),
        ),
      ),
      textScale: 1.4,
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Send OTP'), findsOneWidget);
  });

  testWidgets('empty and error states stay inside compact widths', (tester) async {
    await _pumpAt(
      tester,
      const Size(320, 568),
      MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(
          body: ErrorState(title: "Couldn't load messages. Try again.", onRetry: null),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text("Couldn't load messages. Try again."), findsOneWidget);
  });

  testWidgets('expanded breakpoint is used for tablet-width layouts', (tester) async {
    expect(AppBreakpoints.expanded, 840);
    await _pumpAt(
      tester,
      const Size(1024, 768),
      MaterialApp(
        theme: AppTheme.light(),
        home: Builder(
          builder: (context) {
            return Scaffold(
              body: Text(AppBreakpoints.isExpanded(context) ? 'expanded' : 'compact'),
            );
          },
        ),
      ),
    );
    expect(find.text('expanded'), findsOneWidget);
  });

  testWidgets('emoji-heavy conversation previews do not overflow', (tester) async {
    await _pumpAt(
      tester,
      const Size(360, 740),
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: ConversationTile(
            title: '🎉 Celebration Committee 🎉',
            preview: '🔥🔥🔥 Please review the campaign report 📊📊📊 and share comments today',
            time: 'Yesterday',
            unread: 120,
            onTap: () {},
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('filter chips and muted conversation tiles stay readable', (tester) async {
    await _pumpAt(
      tester,
      const Size(360, 740),
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: Column(
            children: [
              MiChatFilterChips(
                selected: 'unread',
                onSelected: (_) {},
                options: const [
                  FilterOption('all', 'All'),
                  FilterOption('unread', 'Unread'),
                  FilterOption('groups', 'Groups'),
                  FilterOption('calls', 'Calls'),
                ],
              ),
              ConversationTile(
                title: 'Finance team',
                preview: 'You: shared the invoice',
                time: '09:15',
                unread: 2,
                muted: true,
                onTap: () {},
              ),
              const ReplyPreview(
                message: {'senderName': 'Priya', 'content': 'Please call me when free', 'messageType': 'text'},
              ),
            ],
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Calls'), findsOneWidget);
    expect(find.text('Priya'), findsOneWidget);
    expect(find.byIcon(Icons.volume_off), findsOneWidget);
  });

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
    expect(find.textContaining('This message was deleted'), findsNothing);
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
    expect(find.text('Reply'), findsNothing);
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
    expect(find.byType(SizedBox).evaluate().any((node) {
      final box = node.widget as SizedBox;
      return box.width == 220 && box.height == 160;
    }), isTrue);
    expect(find.text('voice-note.m4a'), findsOneWidget);
  });
}
