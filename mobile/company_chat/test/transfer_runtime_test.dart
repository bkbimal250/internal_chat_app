import 'package:company_chat/features/media/transfer_runtime.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('missing parts resume from completed ETags', () {
    expect(missingPartNumbers(4, [2, 3]), [1, 4]);
  });

  test('retry delay grows with the attempt number', () {
    expect(retryDelay(0, baseMs: 100).inMilliseconds, 100);
    expect(retryDelay(2, baseMs: 100).inMilliseconds, 300);
  });

  test('runPool keeps bounded concurrency and all results', () async {
    var inflight = 0;
    var maxInflight = 0;
    final result = await runPool<int>([1, 2, 3, 4, 5], 2, (item) async {
      inflight += 1;
      if (inflight > maxInflight) maxInflight = inflight;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      inflight -= 1;
      return item;
    });
    expect(result, [1, 2, 3, 4, 5]);
    expect(maxInflight, lessThanOrEqualTo(2));
  });
}
