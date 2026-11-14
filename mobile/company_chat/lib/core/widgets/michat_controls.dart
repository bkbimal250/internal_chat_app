import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class MiChatButton extends StatelessWidget {
  const MiChatButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.navy),
            )
          : Text(label),
    );
  }
}

class MiChatTextField extends StatelessWidget {
  const MiChatTextField({
    super.key,
    required this.controller,
    this.label,
    this.hint,
    this.obscure = false,
    this.suffix,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.autofocus = false,
    this.readOnly = false,
    this.maxLines = 1,
    this.onSubmitted,
    this.onChanged,
    this.inputFormatters,
    this.focusNode,
  });

  final TextEditingController controller;
  final String? label;
  final String? hint;
  final bool obscure;
  final Widget? suffix;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final bool autofocus;
  final bool readOnly;
  final int maxLines;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;
  final List<TextInputFormatter>? inputFormatters;
  final FocusNode? focusNode;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      focusNode: focusNode,
      obscureText: obscure,
      readOnly: readOnly,
      autofocus: autofocus,
      maxLines: maxLines,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      autofillHints: autofillHints,
      inputFormatters: inputFormatters,
      onSubmitted: onSubmitted,
      onChanged: onChanged,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        suffixIcon: suffix,
      ),
    );
  }
}

class MiChatOtpInput extends StatefulWidget {
  const MiChatOtpInput({
    super.key,
    required this.controller,
    this.onCompleted,
    this.enabled = true,
  });

  final TextEditingController controller;
  final ValueChanged<String>? onCompleted;
  final bool enabled;

  @override
  State<MiChatOtpInput> createState() => _MiChatOtpInputState();
}

class _MiChatOtpInputState extends State<MiChatOtpInput> {
  final _nodes = List.generate(6, (_) => FocusNode());
  late final List<TextEditingController> _fields;

  @override
  void initState() {
    super.initState();
    final initial = widget.controller.text.replaceAll(RegExp(r'\D'), '');
    _fields = List.generate(6, (index) {
      return TextEditingController(text: index < initial.length ? initial[index] : '');
    });
  }

  @override
  void dispose() {
    for (final node in _nodes) {
      node.dispose();
    }
    for (final field in _fields) {
      field.dispose();
    }
    super.dispose();
  }

  String get _code => _fields.map((field) => field.text).join();

  void _emit() {
    final code = _code;
    widget.controller.value = TextEditingValue(
      text: code,
      selection: TextSelection.collapsed(offset: code.length),
    );
    if (code.length == 6) widget.onCompleted?.call(code);
  }

  void _distribute(String raw, int start) {
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return;
    final chars = List<String>.generate(6, (index) => _fields[index].text);
    if (start == 0 && digits.length > 1) {
      for (var i = 0; i < 6; i++) {
        chars[i] = i < digits.length ? digits[i] : '';
      }
    } else {
      for (var i = 0; i < digits.length && start + i < 6; i++) {
        chars[start + i] = digits[i];
      }
    }
    for (var i = 0; i < 6; i++) {
      _fields[i].text = chars[i];
    }
    final next = chars.indexWhere((item) => item.isEmpty);
    _nodes[next == -1 ? 5 : next].requestFocus();
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    return AutofillGroup(
      child: Semantics(
        label: '6-digit verification code',
        child: Row(
          children: [
            for (var i = 0; i < 6; i++) ...[
              if (i > 0) const SizedBox(width: 6),
              Expanded(
                child: SizedBox(
                  height: AppSpacing.inputHeight,
                  child: TextField(
                    controller: _fields[i],
                    focusNode: _nodes[i],
                    enabled: widget.enabled,
                    autofocus: i == 0,
                    textAlign: TextAlign.center,
                    keyboardType: TextInputType.number,
                    textInputAction: i == 5 ? TextInputAction.done : TextInputAction.next,
                    autofillHints: i == 0 ? const [AutofillHints.oneTimeCode] : null,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(6),
                    ],
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.navy),
                    decoration: const InputDecoration(counterText: ''),
                    onChanged: (value) {
                      if (value.length > 1) {
                        _distribute(value, 0);
                        return;
                      }
                      if (value.isEmpty && i > 0) _nodes[i - 1].requestFocus();
                      if (value.length == 1 && i < 5) _nodes[i + 1].requestFocus();
                      _emit();
                    },
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class MiChatSectionHeader extends StatelessWidget {
  const MiChatSectionHeader(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.8,
          color: AppColors.slate,
        ),
      ),
    );
  }
}
