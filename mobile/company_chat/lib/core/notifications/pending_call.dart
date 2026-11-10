import 'package:flutter/foundation.dart';

class PendingCallRoute extends ChangeNotifier {
  String? callId;
  String? action;

  void open(String? id, {String? callAction}) {
    if (id == null || id.isEmpty) return;
    callId = id;
    action = callAction;
    notifyListeners();
  }

  void clearIf(String id) {
    if (callId == id) {
      callId = null;
      action = null;
    }
  }
}

final pendingCallRoute = PendingCallRoute();
