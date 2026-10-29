import 'dart:convert';
import 'dart:io';

abstract interface class CheckpointApi {
  Future<Map<String, dynamic>> state();
  Future<Map<String, dynamic>> command(
    String action,
    Map<String, dynamic> body,
  );
  Future<String> photo(String id);
  void close();
}

class LocalCheckpointApi implements CheckpointApi {
  LocalCheckpointApi({this.port = 9010});
  final int port;
  final _client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
  Future<Map<String, dynamic>> _request(
    String path,
    Map<String, dynamic>? body,
  ) async {
    final uri = Uri.parse('http://127.0.0.1:$port/api/$path');
    final request = await _client
        .openUrl(body == null ? 'GET' : 'POST', uri)
        .timeout(const Duration(seconds: 3));
    if (body != null) {
      request.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
      request.write(jsonEncode(body));
    }
    final response = await request.close().timeout(const Duration(seconds: 3));
    final text = await response
        .transform(utf8.decoder)
        .join()
        .timeout(const Duration(seconds: 3));
    final data = jsonDecode(text) as Map<String, dynamic>;
    if (response.statusCode != 200) {
      throw HttpException(
        data['error'] as String? ?? 'Checkpoint rejected the command',
      );
    }
    return data;
  }

  @override
  Future<Map<String, dynamic>> state() => _request('state', null);
  @override
  Future<Map<String, dynamic>> command(
    String action,
    Map<String, dynamic> body,
  ) => _request(action, body);
  @override
  Future<String> photo(String id) async =>
      (await _request(
            'photo?id=${Uri.encodeQueryComponent(id)}',
            null,
          ))['imageBase64']
          as String;
  @override
  void close() => _client.close(force: true);
}

class CheckpointSnapshot {
  CheckpointSnapshot.fromJson(Map<String, dynamic> json)
    : revision = json['revision'] as int,
      startedAt = json['startedAt'] as int,
      serverTime = json['serverTime'] as int,
      licence = (json['entry'] as Map)['licence'] as String,
      company = (json['entry'] as Map)['company'] as String,
      profile = (json['entry'] as Map)['profileName'] as String,
      decision = json['decision'] as String,
      reason = json['reason'] as String,
      presentation = Map<String, dynamic>.from(
        json['presentation'] as Map? ?? {},
      ),
      inspection = Map<String, dynamic>.from(json['inspection'] as Map? ?? {}),
      scanned = json['event'] != null,
      opened = (json['openedAt'] as int) > 0;
  final int revision, startedAt, serverTime;
  final String licence, company, profile, decision, reason;
  final Map<String, dynamic> presentation;
  final Map<String, dynamic> inspection;
  String get step => inspection['step'] as String? ?? 'ready';
  int get inspectionVersion => inspection['version'] as int? ?? 0;
  String field(String key, [String missing = 'Not supplied']) =>
      (presentation[key] as String?)?.trim().isNotEmpty == true
      ? presentation[key] as String
      : missing;
  String get direction => field('direction', 'ENTRY');
  String get checkpoint => field('checkpoint', 'North checkpoint');
  String get category => field('category', profile);
  String get displayCompany => field('company', company);
  final bool scanned, opened;
  String get identity => '$startedAt/$revision';
}
