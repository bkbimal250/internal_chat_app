import 'package:company_chat/core/config/app_config.dart';

String rewritePublicUrl(String url, {String? apiBase}) {
  final parsed = Uri.tryParse(url);
  if (parsed == null || parsed.host.isEmpty) return url;
  final api = Uri.tryParse(apiBase ?? AppConfig.apiBaseUrl);
  if (api == null || api.host.isEmpty) return url;
  final loopback = parsed.host == '127.0.0.1' || parsed.host == 'localhost';
  if (loopback && api.host != parsed.host) {
    return parsed.replace(host: api.host).toString();
  }
  return url;
}
