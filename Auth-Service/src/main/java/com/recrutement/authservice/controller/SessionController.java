
package com.recrutement.authservice.controller;

import com.recrutement.authservice.dto.AuthResponse;
import com.recrutement.authservice.service.AuthService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth/session")
public class SessionController {

    private static final String COOKIE_NAME = "refresh_token";
    private static final String FRONTEND_ORIGIN = "http://localhost:4200";

    private final AuthService authService;

    public SessionController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(
            @RequestHeader(value = "Origin", required = false) String origin,
            @RequestHeader(value = "X-Session-Request", required = false) String header,
            @CookieValue(value = COOKIE_NAME, required = false) String refreshToken) {

        if (!isAllowed(origin, header)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        if (refreshToken == null || refreshToken.isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        AuthResponse response = authService.refreshToken(refreshToken);
        response.setRefreshToken(null);

        return ResponseEntity.ok(response);
    }

    @PostMapping("/logout")
    public ResponseEntity<String> logout(
            @RequestHeader(value = "Origin", required = false) String origin,
            @RequestHeader(value = "X-Session-Request", required = false) String header,
            @CookieValue(value = COOKIE_NAME, required = false) String refreshToken) {

        if (!isAllowed(origin, header)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        if (refreshToken != null && !refreshToken.isBlank()) {
            authService.logout(refreshToken);
        }

        ResponseCookie cookie = ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .secure(false) // Développement local HTTP
                .sameSite("Strict")
                .path("/auth")
                .maxAge(0)
                .build();

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body("Logged out successfully");
    }

    private boolean isAllowed(String origin, String header) {
        return FRONTEND_ORIGIN.equals(origin)
                && "browser".equals(header);
    }
}
