import 'dart:async';

import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/brand_mark.dart';
import 'package:company_chat/core/widgets/michat_controls.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum _LoginMethod { phone, otp, password }

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String _dial = '+91';
  String? _otpPhone;
  String? _error;
  bool _busy = false;
  bool _obscure = true;
  bool _submitting = false;
  _LoginMethod _method = _LoginMethod.phone;
  int _cooldown = 0;
  Timer? _timer;

  static const _dials = ['+91', '+1', '+44', '+971', '+65', '+61'];

  @override
  void dispose() {
    _timer?.cancel();
    _username.dispose();
    _password.dispose();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  String _friendly(Object error) {
    if (error is ApiError) return error.message;
    return 'Something went wrong. Please try again.';
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = _friendly(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startCooldown(int seconds) {
    _timer?.cancel();
    setState(() => _cooldown = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_cooldown <= 1) {
        timer.cancel();
        setState(() => _cooldown = 0);
      } else {
        setState(() => _cooldown -= 1);
      }
    });
  }

  String _normalizedPhone() {
    final digits = _phone.text.replaceAll(RegExp(r'\D'), '');
    return '$_dial$digits';
  }

  Future<void> _sendCode() async {
    final digits = _phone.text.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 8) {
      setState(() => _error = 'Enter a valid mobile number.');
      return;
    }
    await _run(() async {
      final phone = _normalizedPhone();
      final result = await ref.read(authControllerProvider.notifier).requestOtp(phone);
      if (!mounted) return;
      setState(() {
        _otpPhone = phone;
        _method = _LoginMethod.otp;
        _code.clear();
      });
      final retry = (result['retryAfterSeconds'] as num?)?.toInt() ?? 60;
      _startCooldown(retry);
    });
  }

  Future<void> _verify() async {
    if (_submitting) return;
    final code = _code.text.replaceAll(RegExp(r'\D'), '');
    if (code.length != 6 || _otpPhone == null) {
      setState(() => _error = 'Enter the 6-digit code.');
      return;
    }
    _submitting = true;
    await _run(() => ref.read(authControllerProvider.notifier).verifyOtp(phone: _otpPhone!, code: code));
    _submitting = false;
  }

  Future<void> _submitPassword() async {
    if (_username.text.trim().length < 3 || _password.text.isEmpty) {
      setState(() => _error = 'Enter your username and password.');
      return;
    }
    await _run(() => ref.read(authControllerProvider.notifier).login(
          username: _username.text.trim(),
          password: _password.text,
        ));
  }

  @override
  Widget build(BuildContext context) {
    final padding = AppBreakpoints.pagePadding(context);
    final maxWidth = AppBreakpoints.isExpanded(context) ? 460.0 : 440.0;
    return Scaffold(
      backgroundColor: AppColors.ivory,
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: ListView(
              padding: padding.copyWith(top: 28, bottom: 28),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              children: [
                const BrandMark(),
                const SizedBox(height: 36),
                Text(_heading, style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 8),
                Text(_subtitle, style: const TextStyle(color: AppColors.slate, height: 1.4, fontSize: 15)),
                const SizedBox(height: 28),
                if (_error != null)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.error.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.error.withValues(alpha: 0.25)),
                    ),
                    child: Text(_error!, style: const TextStyle(color: AppColors.error)),
                  ),
                if (_method == _LoginMethod.phone) _phoneForm(),
                if (_method == _LoginMethod.otp) _otpForm(),
                if (_method == _LoginMethod.password) _passwordForm(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String get _heading => switch (_method) {
        _LoginMethod.password => 'Sign in with username',
        _LoginMethod.otp => 'Verify your number',
        _LoginMethod.phone => 'Welcome to MiChat',
      };

  String get _subtitle => switch (_method) {
        _LoginMethod.password => 'Use your company account credentials.',
        _LoginMethod.otp => 'Enter the 6-digit code sent to your mobile number.',
        _LoginMethod.phone => 'Enter your mobile number to sign in securely.',
      };

  Widget _phoneForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Mobile number', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 92,
              child: InputDecorator(
                decoration: const InputDecoration(
                  contentPadding: EdgeInsets.fromLTRB(10, 4, 4, 4),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    isExpanded: true,
                    value: _dial,
                    items: [
                      for (final dial in _dials) DropdownMenuItem(value: dial, child: Text(dial)),
                    ],
                    onChanged: (value) => setState(() => _dial = value ?? '+91'),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: MiChatTextField(
                controller: _phone,
                hint: 'Enter mobile number',
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.telephoneNumberNational],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(14)],
                onSubmitted: (_) => _sendCode(),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        MiChatButton(
          label: _busy ? 'Sending…' : _cooldown > 0 ? 'Resend in ${_cooldown}s' : 'Send OTP',
          busy: _busy,
          onPressed: _cooldown > 0 ? null : _sendCode,
        ),
        const SizedBox(height: 16),
        TextButton(
          onPressed: () => setState(() {
            _method = _LoginMethod.password;
            _error = null;
          }),
          child: const Text('Try another way'),
        ),
      ],
    );
  }

  Widget _otpForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_otpPhone != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(_otpPhone!, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.navy)),
          ),
        const Text('Enter 6-digit code', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        MiChatOtpInput(
          controller: _code,
          enabled: !_busy,
          onCompleted: (_) => _verify(),
        ),
        const SizedBox(height: 20),
        MiChatButton(
          label: _busy ? 'Verifying…' : 'Verify & Sign in',
          busy: _busy,
          onPressed: _verify,
        ),
        const SizedBox(height: 12),
        TextButton(
          onPressed: _busy || _cooldown > 0 ? null : _sendCode,
          child: Text(_cooldown > 0 ? 'Resend OTP in ${_cooldown}s' : 'Resend OTP'),
        ),
        TextButton(
          onPressed: () => setState(() {
            _method = _LoginMethod.phone;
            _error = null;
            _code.clear();
          }),
          child: const Text('Change phone number'),
        ),
      ],
    );
  }

  Widget _passwordForm() {
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MiChatTextField(
            controller: _username,
            label: 'Username',
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.username],
          ),
          const SizedBox(height: 12),
          MiChatTextField(
            controller: _password,
            label: 'Password',
            obscure: _obscure,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.password],
            onSubmitted: (_) => _submitPassword(),
            suffix: IconButton(
              tooltip: _obscure ? 'Show password' : 'Hide password',
              onPressed: () => setState(() => _obscure = !_obscure),
              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
            ),
          ),
          const SizedBox(height: 20),
          MiChatButton(
            label: _busy ? 'Signing in…' : 'Sign in',
            busy: _busy,
            onPressed: _submitPassword,
          ),
          const SizedBox(height: 16),
          TextButton(
            onPressed: () => setState(() {
              _method = _LoginMethod.phone;
              _error = null;
            }),
            child: const Text('Back to Phone & OTP'),
          ),
        ],
      ),
    );
  }
}
