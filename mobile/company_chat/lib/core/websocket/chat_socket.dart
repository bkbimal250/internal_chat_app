import 'dart:async';
import 'dart:convert';

import 'package:company_chat/core/config/app_config.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:web_socket_channel/io.dart';

typedef ChatEventHandler = void Function(Map<String, dynamic> event);
typedef ChatRefresh = Future<void> Function();
typedef ChatSocketFactory = ChatSocketConnection Function({
  required Uri uri,
  required String token,
});

bool websocketCloseRequiresReauth(int? code) => code == 4001;

class ChatSocketConnection {
  ChatSocketConnection({
    required this.stream,
    required this.add,
    required this.close,
    this.closeCode,
  });

  final Stream<dynamic> stream;
  final void Function(dynamic data) add;
  final Future<void> Function([int? code, String? reason]) close;
  final int? Function()? closeCode;
}

class ChatSocket {
  ChatSocket(
    this.store, {
    this.refreshSession,
    ChatSocketFactory? openChannel,
  }) : _openChannel = openChannel ?? _defaultOpen;

  final SessionStore store;
  final ChatRefresh? refreshSession;
  final ChatSocketFactory _openChannel;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  ChatSocketConnection? _channel;
  Timer? _ping;
  Timer? _reconnect;
  int _attempt = 0;
  bool _wanted = false;
  int _generation = 0;
  bool _reauthing = false;

  Stream<Map<String, dynamic>> get events => _events.stream;

  static ChatSocketConnection _defaultOpen({required Uri uri, required String token}) {
    final channel = IOWebSocketChannel.connect(
      uri,
      headers: {'Authorization': 'Bearer $token'},
      protocols: ['company-chat', token],
    );
    return ChatSocketConnection(
      stream: channel.stream,
      add: channel.sink.add,
      close: ([code, reason]) async {
        await channel.sink.close(code, reason);
      },
      closeCode: () => channel.closeCode,
    );
  }

  void connect() {
    _wanted = true;
    if (_channel != null) return;
    _open();
  }

  void disconnect() {
    _wanted = false;
    _generation++;
    _ping?.cancel();
    _reconnect?.cancel();
    unawaited(_channel?.close(1000, 'client_disconnect') ?? Future.value());
    _channel = null;
  }

  void reconnect() {
    disconnect();
    connect();
  }

  void send(String event, [Map<String, dynamic>? data]) {
    final channel = _channel;
    if (channel == null) return;
    channel.add(jsonEncode({'event': event, 'data': data ?? {}}));
  }

  void _open() {
    final token = store.accessToken;
    if (!_wanted || token == null || token.isEmpty) return;
    if (_channel != null) return;
    final gen = ++_generation;
    try {
      final channel = _openChannel(
        uri: Uri.parse(AppConfig.wsUrl),
        token: token,
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
          _channel = null;
          if (websocketCloseRequiresReauth(channel.closeCode?.call())) {
            unawaited(_reauth(gen));
            return;
          }
          _schedule();
        },
        onError: (_) {
          if (gen != _generation) return;
          _channel = null;
          _schedule();
        },
        cancelOnError: true,
      );
      _attempt = 0;
      _ping?.cancel();
      send('ping');
      _ping = Timer.periodic(const Duration(seconds: 25), (_) => send('ping'));
    } catch (_) {
      _channel = null;
      _schedule();
    }
  }

  Future<void> _reauth(int gen) async {
    if (_reauthing || !_wanted || gen != _generation) return;
    _reauthing = true;
    try {
      await refreshSession?.call();
      if (!_wanted || gen != _generation) return;
      _open();
    } catch (error) {
      if (error is ApiError && error.isSessionInvalid) {
        _wanted = false;
        return;
      }
      _schedule();
    } finally {
      _reauthing = false;
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
