const multipartConcurrency = 3;

Duration retryDelay(int attempt, {int baseMs = 400}) {
  final exp = attempt + 1 > 8 ? 8 : attempt + 1;
  return Duration(milliseconds: baseMs * exp);
}

List<int> missingPartNumbers(int partCount, Iterable<int> completed) {
  final done = completed.toSet();
  return [for (var part = 1; part <= partCount; part++) if (!done.contains(part)) part];
}

Future<List<T>> runPool<T>(
  List<T> items,
  int limit,
  Future<T> Function(T item) worker,
) async {
  if (items.isEmpty) return <T>[];
  final results = List<T?>.filled(items.length, null);
  var cursor = 0;
  Future<void> pump() async {
    while (true) {
      final index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Future.wait(
    List.generate(limit.clamp(1, items.length), (_) => pump()),
  );
  return results.cast<T>();
}
