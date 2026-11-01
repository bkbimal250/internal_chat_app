import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String _dial = '+91';
  String? _otpPhone;
  String? _error;
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _tabs.dispose();
    _username.dispose();
    _password.dispose();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            const SizedBox(height: 24),
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.card,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: const Text('CC', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(width: 12),
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Company Chat', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                    Text('Internal workspace', style: TextStyle(color: AppColors.mutedForeground)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 32),
            const Text('Sign in', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text(
              'Sign in with a verified work phone or your username and password.',
              style: TextStyle(color: AppColors.mutedForeground),
            ),
            const SizedBox(height: 20),
            TabBar(
              controller: _tabs,
              labelColor: AppColors.goldForeground,
              indicatorColor: AppColors.gold,
              tabs: const [
                Tab(text: 'Phone & OTP'),
                Tab(text: 'Username'),
              ],
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!, style: const TextStyle(color: AppColors.destructive)),
              ),
            SizedBox(
              height: 360,
              child: TabBarView(
                controller: _tabs,
                children: [_otpForm(), _passwordForm()],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _passwordForm() {
    return Column(
      children: [
        TextField(
          controller: _username,
          autocorrect: false,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(labelText: 'Username'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _password,
          obscureText: _obscure,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _submitPassword(),
          decoration: InputDecoration(
            labelText: 'Password',
            suffixIcon: IconButton(
              onPressed: () => setState(() => _obscure = !_obscure),
              icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
            ),
          ),
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _submitPassword,
          child: Text(_busy ? 'Signing in…' : 'Sign in'),
        ),
      ],
    );
  }

  Widget _otpForm() {
    return Column(
      children: [
        Row(
          children: [
            SizedBox(
              width: 110,
              child: DropdownButtonFormField<String>(
                initialValue: _dial,
                items: const [
                  DropdownMenuItem(value: '+91', child: Text('+91')),
                  DropdownMenuItem(value: '+1', child: Text('+1')),
                  DropdownMenuItem(value: '+44', child: Text('+44')),
                ],
                onChanged: (value) => setState(() => _dial = value ?? '+91'),
                decoration: const InputDecoration(labelText: 'Code'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Phone number'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _busy
              ? null
              : () => _run(() async {
                    final phone = '$_dial${_phone.text.trim()}';
                    await ref.read(authControllerProvider.notifier).requestOtp(phone);
                    setState(() => _otpPhone = phone);
                  }),
          child: const Text('Send code'),
        ),
        if (_otpPhone != null) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _code,
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: const InputDecoration(labelText: '6-digit code'),
          ),
          FilledButton(
            onPressed: _busy
                ? null
                : () => _run(() => ref.read(authControllerProvider.notifier).verifyOtp(
                      phone: _otpPhone!,
                      code: _code.text.trim(),
                    )),
            child: const Text('Verify and sign in'),
          ),
        ],
      ],
    );
  }

  void _submitPassword() {
    _run(() => ref.read(authControllerProvider.notifier).login(
          username: _username.text.trim(),
          password: _password.text,
        ));
  }
}
