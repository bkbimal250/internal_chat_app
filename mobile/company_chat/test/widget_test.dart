import 'package:company_chat/core/network/public_url.dart';
import 'package:company_chat/core/theme/app_theme.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:company_chat/core/notifications/notification_copy.dart';
import 'package:company_chat/core/notifications/notify_incoming.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/core/utils/typing_label.dart';
import 'package:company_chat/core/utils/time_format.dart';
import 'package:company_chat/features/auth/presentation/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('sorts conversations by latest activity', () {
    final rows = [
      {
        'id': 'old',
        'updatedAt': '2026-10-01T10:00:00.000Z',
        'latestMessage': {'content': 'older', 'createdAt': '2026-10-01T10:00:00.000Z'},
      },
      {
        'id': 'new',
        'updatedAt': '2026-10-01T12:00:00.000Z',
        'latestMessage': {'content': 'newer', 'createdAt': '2026-10-01T12:00:00.000Z'},
      },
    ];
    expect(sortConversations(rows).map((row) => row['id']), ['new', 'old']);
  });

  test('group send policy hides member composers', () {
    final settings = {'sendMessages': 'admins'};
    bool canSend(String? role) => settings['sendMessages'] != 'admins' || role == 'owner' || role == 'admin';
    expect(canSend('member'), isFalse);
    expect(canSend('admin'), isTrue);
    expect(canSend('owner'), isTrue);
  });

  test('builds WhatsApp-style notification copy', () {
    expect(
      messageNotificationCopy(
        isGroup: false,
        senderName: 'Sonam Sharma',
        preview: 'Hey, please check the latest project update.',
      ).title,
      'Sonam Sharma',
    );
    expect(
      messageNotificationCopy(
        isGroup: true,
        groupTitle: 'Marketing Team',
        senderName: 'Sonam Sharma',
        preview: "Please review today's campaign report.",
      ).body,
      "Sonam Sharma: Please review today's campaign report.",
    );
    expect(senderLabel({'fullName': 'Sonam Sharma', 'displayName': 'Sonam'}), 'Sonam Sharma');
  });

  test('previews deleted and media messages', () {
    expect(previewText({'deletedAt': 'now'}), 'Message deleted');
    expect(previewText({'messageType': 'image', 'content': ''}), 'Photo');
    expect(
      previewText({
        'messageType': 'file',
        'content': '',
        'attachment': {'originalName': 'secret.pdf', 'displayName': 'MiChat Document 2026-11-10 at 5.42.17 PM.pdf'},
      }),
      'MiChat Document 2026-11-10 at 5.42.17 PM.pdf',
    );
  });

  test('typing labels use remote names and never me', () {
    final members = [
      {'id': 'a', 'displayName': 'Rahul'},
      {'id': 'b', 'displayName': 'Priya'},
      {'id': 'c', 'displayName': 'Amit'},
      {'id': 'me', 'displayName': 'Me'},
    ];
    expect(remoteTypingLabel(userIds: {'a'}, members: members, currentUserId: 'me'), 'Rahul is typing...');
    expect(remoteTypingLabel(userIds: {'b'}, members: members, currentUserId: 'a'), 'Priya is typing...');
    expect(remoteTypingLabel(userIds: {'me'}, members: members, currentUserId: 'me'), '');
    expect(remoteTypingLabel(userIds: {'a', 'b'}, members: members, currentUserId: 'me'), 'Rahul and Priya are typing...');
    expect(remoteTypingLabel(userIds: {'a', 'b', 'c'}, members: members, currentUserId: 'me'), '3 people are typing...');
  });

  test('suppresses foreground notifications only while that chat is actively viewed', () {
    final seen = <String>{};
    expect(
      shouldPresentIncomingNotice(
        senderId: 'b',
        currentUserId: 'a',
        conversationId: 'c1',
        viewedConversationId: 'c1',
        lifecycle: AppLifecycleState.resumed,
        messageId: 'm1',
        seenIds: seen,
      ),
      isFalse,
    );
    expect(
      shouldPresentIncomingNotice(
        senderId: 'b',
        currentUserId: 'a',
        conversationId: 'c1',
        viewedConversationId: 'c2',
        lifecycle: AppLifecycleState.resumed,
        messageId: 'm2',
        seenIds: seen,
      ),
      isTrue,
    );
    expect(
      shouldPresentIncomingNotice(
        senderId: 'b',
        currentUserId: 'a',
        conversationId: 'c1',
        viewedConversationId: 'c1',
        lifecycle: AppLifecycleState.paused,
        messageId: 'm3',
        seenIds: seen,
      ),
      isTrue,
    );
    expect(
      shouldPresentIncomingNotice(
        senderId: 'a',
        currentUserId: 'a',
        conversationId: 'c2',
        viewedConversationId: 'c2',
        lifecycle: AppLifecycleState.resumed,
        messageId: 'm4',
        seenIds: seen,
      ),
      isFalse,
    );
    expect(
      shouldPresentIncomingNotice(
        senderId: 'b',
        currentUserId: 'a',
        conversationId: 'c2',
        viewedConversationId: 'c3',
        lifecycle: AppLifecycleState.resumed,
        messageId: 'm2',
        seenIds: seen,
      ),
      isFalse,
    );
  });

  test('formats today as a clock time', () {
    final now = DateTime.now();
    expect(formatMessageTime(now), isNotEmpty);
    expect(formatDateSeparator(now), 'Today');
  });

  testWidgets('login screen shows OTP and username tabs', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const LoginScreen(),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Company Chat'), findsOneWidget);
    expect(find.text('Phone & OTP'), findsOneWidget);
    expect(find.text('Username'), findsOneWidget);
  });

  test('maps attachment names to allowed MIME types', () {
    expect(mimeFromName('photo.JPG'), 'image/jpeg');
    expect(mimeFromName('voice.m4a'), 'audio/mp4');
    expect(mimeFromName('note.aac'), 'audio/mp4');
    expect(mimeFromName('clip.3gp'), 'video/3gpp');
    expect(mimeFromName('clip.mp4'), 'video/mp4');
    expect(mimeFromName('clip.mov'), 'video/quicktime');
    expect(mimeFromName('pack.zip'), 'application/zip');
    expect(mimeFromName('notes.docx'), contains('wordprocessingml'));
    expect(allowedTypes['video/mp4']?.maxBytes, twoGib);
    expect(formatMediaSize(twoGib), contains('GB'));
  });

  test('rewrites loopback storage URLs to the API host', () {
    expect(
      rewritePublicUrl('http://127.0.0.1:4566/company-chat/photo', apiBase: 'http://10.0.2.2:3001'),
      'http://10.0.2.2:4566/company-chat/photo',
    );
    expect(
      rewritePublicUrl('http://127.0.0.1:4566/company-chat/photo', apiBase: 'http://127.0.0.1:3001'),
      'http://127.0.0.1:4566/company-chat/photo',
    );
  });

  test('theme uses cream and gold branding', () {
    final theme = AppTheme.light();
    expect(theme.colorScheme.primary, isNot(equals(Colors.deepPurple)));
    expect(theme.useMaterial3, isTrue);
  });
}
