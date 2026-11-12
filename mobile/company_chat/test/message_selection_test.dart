import 'package:company_chat/core/theme/app_theme.dart';
import 'package:company_chat/core/widgets/conversation_tile.dart';
import 'package:company_chat/features/messages/presentation/widgets/delete_message_sheet.dart';
import 'package:company_chat/features/messages/presentation/widgets/forward_picker.dart';
import 'package:company_chat/features/messages/presentation/widgets/selection_toolbar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('single selection toolbar shows reply forward copy delete and share', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          appBar: AppBar(
            title: const Text('1 selected'),
            actions: [
              MessageSelectionActions(
                compact: false,
                showReply: true,
                showForward: true,
                showCopy: true,
                showDelete: true,
                showShare: true,
                onReply: () {},
                onForward: () {},
                onCopy: () {},
                onDelete: () {},
                onShare: () {},
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.byTooltip('Reply'), findsOneWidget);
    expect(find.byTooltip('Forward'), findsOneWidget);
    expect(find.byTooltip('Copy'), findsOneWidget);
    expect(find.byTooltip('Delete'), findsOneWidget);
    expect(find.byTooltip('Share'), findsOneWidget);
  });

  testWidgets('multiple selection hides reply and compact screens overflow copy and share', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          appBar: AppBar(
            title: const Text('2 selected'),
            actions: [
              MessageSelectionActions(
                compact: true,
                showReply: false,
                showForward: true,
                showCopy: true,
                showDelete: true,
                showShare: true,
                onForward: () {},
                onCopy: () {},
                onDelete: () {},
                onShare: () {},
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.byTooltip('Reply'), findsNothing);
    expect(find.byTooltip('Forward'), findsOneWidget);
    expect(find.byTooltip('Delete'), findsOneWidget);
    expect(find.byTooltip('Copy'), findsNothing);
    expect(find.byTooltip('Share'), findsNothing);
    expect(find.byTooltip('More'), findsOneWidget);
  });

  testWidgets('delete sheet offers everyone only when authorized', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () => showDeleteMessageSheet(context, count: 1, allowEveryone: true),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Delete for me'), findsOneWidget);
    expect(find.text('Delete for everyone'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
  });

  testWidgets('multiple delete confirmation defaults to delete for me', (tester) async {
    DeleteMessageChoice? choice;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                choice = await showDeleteMessageSheet(context, count: 3, allowEveryone: false);
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Delete 3 messages?'), findsOneWidget);
    expect(find.text('Delete for everyone'), findsNothing);
    await tester.tap(find.text('Delete for me'));
    await tester.pumpAndSettle();
    expect(choice, DeleteMessageChoice.me);
  });

  testWidgets('forward picker lists other chats and skips the current one', (tester) async {
    String? picked;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                picked = await showForwardPicker(
                  context,
                  currentConversationId: 'here',
                  titleOf: (row) => row['title'] as String,
                  conversations: const [
                    {'id': 'here', 'title': 'Current', 'type': 'direct'},
                    {'id': 'there', 'title': 'Priya Sharma', 'type': 'direct'},
                    {'id': 'group', 'title': 'Ops', 'type': 'group'},
                  ],
                );
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Current'), findsNothing);
    expect(find.text('Priya Sharma'), findsOneWidget);
    expect(find.text('Ops'), findsOneWidget);
    await tester.tap(find.text('Ops'));
    await tester.pumpAndSettle();
    expect(picked, 'group');
  });

  testWidgets('back in selection mode can be cancelled without leaving the screen', (tester) async {
    var selecting = true;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: StatefulBuilder(
          builder: (context, setState) {
            return PopScope(
              canPop: !selecting,
              onPopInvokedWithResult: (didPop, _) {
                if (!didPop && selecting) setState(() => selecting = false);
              },
              child: Scaffold(
                appBar: AppBar(
                  leading: selecting
                      ? IconButton(
                          onPressed: () => setState(() => selecting = false),
                          icon: const Icon(Icons.close),
                        )
                      : null,
                  title: Text(selecting ? '1 selected' : 'Chat'),
                ),
                body: ConversationTile(
                  title: 'Chat',
                  preview: 'Hello',
                  time: '10:00',
                  selected: selecting,
                  onTap: () {},
                ),
              ),
            );
          },
        ),
      ),
    );
    expect(find.text('1 selected'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    expect(find.text('Chat'), findsWidgets);
    expect(find.text('1 selected'), findsNothing);
  });
}
