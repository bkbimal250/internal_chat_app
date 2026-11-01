import 'dart:async';
import 'dart:convert';

import 'package:company_chat/core/config/app_config.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

typedef ChatEventHandler = void Function(Map<String, dynamic> event);

class ChatSocket {
  ChatSocket(this.store);

  final SessionStore store;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  WebSocketChannel? _channel;
  Timer? _ping;
  Timer? _reconnect;
  int _attempt = 0;
  bool _wanted = false;
  int _generation = 0;

  Stream<Map<String, dynamic>> get events => _events.stream;

  void connect() {
    _wanted = true;
    _open();
  }

  void disconnect() {
    _wanted = false;
    _generation++;
    _ping?.cancel();
    _reconnect?.cancel();
    _channel?.sink.close();
    _channel = null;
  }

  void reconnect() {
    disconnect();
    connect();
  }

  void send(String event, [Map<String, dynamic>? data]) {
    final channel = _channel;
    if (channel == null) return;
    channel.sink.add(jsonEncode({'event': event, 'data': data ?? {}}));
  }

  void _open() {
    final token = store.accessToken;
    if (!_wanted || token == null || token.isEmpty) return;
    final gen = ++_generation;
    try {
      final channel = IOWebSocketChannel.connect(
        Uri.parse(AppConfig.wsUrl),
        headers: {'Authorization': 'Bearer $token'},
        protocols: ['company-chat', token],
      );
      _channel = channel;
      channel.stream.listen(
        (raw) {
          if (gen != _generation) return;
          try {
            final decoded = jsonDecode(raw as String);
            if (decoded is Map<String, dynamic>) _events.add(decoded);
          } catch (_) {}
        },
        onDone: () {
          if (gen != _generation) return;
          _schedule();
        },
        onError: (_) {
          if (gen != _generation) return;
          _schedule();
        },
        cancelOnError: true,
      );
      _attempt = 0;
      _ping?.cancel();
      send('ping');
      _ping = Timer.periodic(const Duration(seconds: 25), (_) => send('ping'));
    } catch (_) {
      _schedule();
    }
  }

  void _schedule() {
    _ping?.cancel();
    _channel = null;
    if (!_wanted) return;
    final delay = Duration(milliseconds: (1000 * (1 << _attempt.clamp(0, 4))).clamp(1000, 15000));
    _attempt++;
    _reconnect?.cancel();
    _reconnect = Timer(delay, _open);
  }
}
