import 'package:flutter/foundation.dart';

class PendingNotificationRoute extends ChangeNotifier {
  String? conversationId;

  void open(String? id) {
    if (id == null || id.isEmpty) return;
    conversationId = id;
    notifyListeners();
  }

  void clearIf(String id) {
    if (conversationId == id) {
      conversationId = null;
    }
  }
}

final pendingNotificationRoute = PendingNotificationRoute();
