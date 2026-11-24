
package com.recrutement.authservice.controller;

import com.recrutement.authservice.dto.*;
import com.recrutement.authservice.service.AdminUserStatsService;
import com.recrutement.authservice.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private static final String REFRESH_COOKIE = "refresh_token";

    private final AuthService authService;
    private final AdminUserStatsService adminUserStatsService;

    public AuthController(AuthService authService, AdminUserStatsService adminUserStatsService) {
        this.authService = authService;
        this.adminUserStatsService = adminUserStatsService;
    }

    private ResponseCookie createRefreshCookie(String token) {
        return ResponseCookie.from(REFRESH_COOKIE, token)
                .httpOnly(true)
                .secure(false) // Développement local HTTP
                .sameSite("Strict")
                .path("/auth")
                .maxAge(Duration.ofDays(7))
                .build();
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(
            @Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.ok(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(
            @Valid @RequestBody LoginRequest request) {

        AuthResponse result = authService.login(request);
        String refreshToken = result.getRefreshToken();

        result.setRefreshToken(null);

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE,
                        createRefreshCookie(refreshToken).toString())
                .body(result);
    }

    @GetMapping("/me")
    public ResponseEntity<UserResponse> getCurrentUser() {
        return ResponseEntity.ok(authService.getCurrentUser());
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refreshToken(
            @Valid @RequestBody RefreshTokenRequest request) {

        if (request.getRefreshToken() == null
                || request.getRefreshToken().isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        return ResponseEntity.ok(
                authService.refreshToken(request.getRefreshToken()));
    }

    @PostMapping("/logout")
    public ResponseEntity<String> logout(
            @Valid @RequestBody LogoutRequest request) {

        if (request.getRefreshToken() == null
                || request.getRefreshToken().isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
        }

        authService.logout(request.getRefreshToken());

        return ResponseEntity.ok("Logged out successfully");
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<String> forgotPassword(
            @Valid @RequestBody ForgotPasswordRequest request) {
        return ResponseEntity.ok(
                authService.forgotPassword(request.getEmail()));
    }

    @PostMapping("/reset-password")
    public ResponseEntity<String> resetPassword(
            @Valid @RequestBody ResetPasswordRequest request) {
        authService.resetPassword(
                request.getToken(), request.getNewPassword());
        return ResponseEntity.ok("Password reset successfully");
    }

    @PreAuthorize("hasRole('ADMIN')")
    @GetMapping("/admin/stats")
    public ResponseEntity<AdminUserStatsResponse> adminStats() {
        return ResponseEntity.ok(adminUserStatsService.stats());
    }

    @PreAuthorize("hasRole('ADMIN')")
    @GetMapping("/admin/audit")
    public ResponseEntity<java.util.List<com.recrutement.authservice.dto.AdminAuditResponse>> recentAudit() {
        return ResponseEntity.ok(authService.recentAudit());
    }

    @PatchMapping("/users/{id}/deactivate")
    public ResponseEntity<Void> deactivateUser(@PathVariable Long id) {
        authService.deactivateUser(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/users")
    public ResponseEntity<UserResponse> createUser(
            @Valid @RequestBody CreateUserRequest request) {
        return ResponseEntity.status(201)
                .body(authService.createUser(request));
    }

    @PostMapping("/candidates")
    public ResponseEntity<UserResponse> createCandidate(
            @Valid @RequestBody CreateUserRequest request) {
        return ResponseEntity.status(201)
                .body(authService.createCandidate(request));
    }

    @DeleteMapping("/users/{id}")
    public ResponseEntity<Void> deleteUserPermanently(@PathVariable Long id) {
        authService.deleteUserPermanently(id);
        return ResponseEntity.noContent().build();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @PatchMapping("/users/{id}/reactivate")
    public ResponseEntity<Void> reactivateUser(@PathVariable Long id) {
        authService.reactivateUser(id);
        return ResponseEntity.noContent().build();
    }
}
