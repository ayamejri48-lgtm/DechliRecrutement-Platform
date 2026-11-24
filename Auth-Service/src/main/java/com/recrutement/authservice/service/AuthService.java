package com.recrutement.authservice.service;

import com.recrutement.authservice.dto.*;

public interface AuthService {

    AuthResponse register(RegisterRequest request);

    AuthResponse login(LoginRequest request);
    UserResponse getCurrentUser();
    AuthResponse refreshToken(String refreshToken);
    void logout(String refreshToken);
    String forgotPassword(String email);
    void resetPassword(String token, String newPassword);
    void deactivateUser(Long userId);
    UserResponse createUser(CreateUserRequest request);
    UserResponse createCandidate(CreateUserRequest request);
    void deleteUserPermanently(Long userId);
    void reactivateUser(Long userId);

    java.util.List<com.recrutement.authservice.dto.AdminAuditResponse> recentAudit();

}