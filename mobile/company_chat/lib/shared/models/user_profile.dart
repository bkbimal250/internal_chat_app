class UserProfile {
  const UserProfile({
    required this.id,
    required this.username,
    required this.displayName,
    required this.fullName,
    required this.role,
    required this.status,
    required this.mustChangePassword,
    this.employeeCode,
    this.email,
    this.phoneE164,
    this.address,
    this.hasProfilePhoto = false,
    this.profilePhotoUrl,
    this.photoVersion,
  });

  final String id;
  final String username;
  final String displayName;
  final String fullName;
  final String role;
  final String status;
  final bool mustChangePassword;
  final String? employeeCode;
  final String? email;
  final String? phoneE164;
  final String? address;
  final bool hasProfilePhoto;
  final String? profilePhotoUrl;
  final String? photoVersion;

  bool get isAdmin => role == 'admin';

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] as String,
      username: json['username'] as String? ?? '',
      displayName: json['displayName'] as String? ?? '',
      fullName: json['fullName'] as String? ?? json['displayName'] as String? ?? '',
      role: json['role'] as String? ?? 'user',
      status: json['status'] as String? ?? 'active',
      mustChangePassword: json['mustChangePassword'] == true,
      employeeCode: json['employeeCode'] as String?,
      email: json['email'] as String?,
      phoneE164: json['phoneE164'] as String?,
      address: json['address'] as String?,
      hasProfilePhoto: json['hasProfilePhoto'] == true,
      profilePhotoUrl: json['profilePhotoUrl'] as String?,
      photoVersion: (json['photoVersion'] ?? json['updatedAt'])?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'username': username,
        'displayName': displayName,
        'fullName': fullName,
        'role': role,
        'status': status,
        'mustChangePassword': mustChangePassword,
        'employeeCode': employeeCode,
        'email': email,
        'phoneE164': phoneE164,
        'address': address,
        'hasProfilePhoto': hasProfilePhoto,
        'profilePhotoUrl': profilePhotoUrl,
        'photoVersion': photoVersion,
      };
}

class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.sessionId,
    required this.deviceId,
    required this.user,
    this.refreshToken,
    this.csrfToken,
    this.expiresIn = 900,
  });

  final String accessToken;
  final String sessionId;
  final String deviceId;
  final UserProfile user;
  final String? refreshToken;
  final String? csrfToken;
  final int expiresIn;

  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    return AuthTokens(
      accessToken: json['accessToken'] as String,
      sessionId: json['sessionId'] as String,
      deviceId: json['deviceId'] as String,
      refreshToken: json['refreshToken'] as String?,
      csrfToken: json['csrfToken'] as String?,
      expiresIn: json['expiresIn'] as int? ?? 900,
      user: UserProfile.fromJson(json['user'] as Map<String, dynamic>),
    );
  }
}
