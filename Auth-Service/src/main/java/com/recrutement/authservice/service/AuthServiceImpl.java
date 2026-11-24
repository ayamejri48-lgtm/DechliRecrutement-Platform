package com.recrutement.authservice.service;

import com.recrutement.authservice.dto.AuthResponse;
import com.recrutement.authservice.dto.LoginRequest;
import com.recrutement.authservice.dto.RegisterRequest;
import com.recrutement.authservice.entity.User;
import com.recrutement.authservice.enums.Role;
import com.recrutement.authservice.event.UserReactivatedEvent;
import com.recrutement.authservice.event.UserRegisteredEvent;
import com.recrutement.authservice.exception.InvalidCredentialsException;
import com.recrutement.authservice.repository.AdminAuditRepository;
import com.recrutement.authservice.repository.UserRepository;
import com.recrutement.authservice.entity.AdminAuditEntry;
import com.recrutement.authservice.dto.AdminAuditResponse;
import com.recrutement.authservice.service.kafka.KafkaProducerService;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import com.recrutement.authservice.dto.UserResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import com.recrutement.authservice.entity.RefreshToken;
import com.recrutement.authservice.repository.RefreshTokenRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.recrutement.authservice.entity.PasswordResetToken;
import com.recrutement.authservice.repository.PasswordResetTokenRepository;
import org.springframework.transaction.annotation.Transactional;
import com.recrutement.authservice.event.UserDeactivatedEvent;
import com.recrutement.authservice.dto.CreateUserRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import com.recrutement.authservice.event.UserDeletedEvent;
import com.recrutement.authservice.entity.OutboxEvent;
import com.recrutement.authservice.repository.OutboxEventRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;





@Service
public class AuthServiceImpl implements AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final KafkaProducerService kafkaProducerService;
    private final OutboxEventRepository outboxEventRepository;
    private final ObjectMapper objectMapper;
    private final EmailService emailService;
    private final AdminAuditRepository adminAuditRepository;


    public AuthServiceImpl(UserRepository userRepository,
                           PasswordEncoder passwordEncoder,
                           JwtService jwtService ,
                           RefreshTokenRepository refreshTokenRepository,
                           PasswordResetTokenRepository passwordResetTokenRepository,
                            KafkaProducerService kafkaProducerService,OutboxEventRepository outboxEventRepository,
                           ObjectMapper objectMapper , EmailService emailService,
                           AdminAuditRepository adminAuditRepository
                           ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.refreshTokenRepository = refreshTokenRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.kafkaProducerService = kafkaProducerService;
        this.outboxEventRepository = outboxEventRepository;
        this.objectMapper = objectMapper;
        this.emailService = emailService;
        this.adminAuditRepository = adminAuditRepository;
    }

    private String actorEmail() {
        Authentication authentication =
                SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null) {
            return "unknown";
        }
        Object principal = authentication.getPrincipal();
        if (principal instanceof User user && user.getEmail() != null) {
            return user.getEmail();
        }
        String name = authentication.getName();
        return name == null || name.isBlank() ? "unknown" : name;
    }

    private void writeAudit(String action, User target) {
        String actor = actorEmail();
        adminAuditRepository.save(AdminAuditEntry.builder()
                .actorEmail(actor)
                .action(action)
                .targetUserId(target.getId())
                .targetEmail(target.getEmail())
                .createdAt(LocalDateTime.now())
                .build());
    }

    @PreAuthorize("hasRole('ADMIN')")
    public List<AdminAuditResponse> recentAudit() {
        return adminAuditRepository.findTop50ByOrderByCreatedAtDesc().stream()
                .map(row -> new AdminAuditResponse(
                        row.getId(),
                        row.getActorEmail(),
                        row.getAction(),
                        row.getTargetUserId(),
                        row.getTargetEmail(),
                        row.getCreatedAt()
                ))
                .toList();
    }

    @Override
    public AuthResponse register(RegisterRequest request) {

        String normalizedEmail = request.getEmail().trim().toLowerCase();

        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new IllegalArgumentException("Email already exists");
        }

        User user = User.builder()
                .firstName(request.getFirstName())
                .lastName(request.getLastName())
                .email(normalizedEmail)
                .password(passwordEncoder.encode(request.getPassword()))
                .phone(request.getPhone())
                .role(Role.CANDIDATE)
                .enabled(true)
                .status("ACTIVE")
                .createdAt(LocalDateTime.now())
                .build();

        userRepository.save(user);
        UserRegisteredEvent event = new UserRegisteredEvent(
                user.getId(),
                user.getFirstName(),
                user.getLastName(),
                user.getEmail(),
                user.getRole().name()
        );

        kafkaProducerService.sendUserRegisteredEvent(event);

        String token = jwtService.generateToken(user);
        RefreshToken refreshToken = createRefreshToken(user);

        return AuthResponse.builder()
                .token(token)
                .type("Bearer")
                .email(user.getEmail())
                .role(user.getRole().name())
                .refreshToken(refreshToken.getToken())
                .build();
    }

    @Override
    public AuthResponse login(LoginRequest request) {

        String normalizedEmail = request.getEmail().trim().toLowerCase();

        User user = userRepository.findByEmail(normalizedEmail)
                .orElse(null);

        if (user == null || !passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new InvalidCredentialsException("Invalid email or password");
        }

        if (Boolean.FALSE.equals(user.getEnabled())) {
            throw new IllegalArgumentException("Account is disabled");
        }

        if (user.getStatus() == null || !user.getStatus().equalsIgnoreCase("ACTIVE")) {
            throw new IllegalArgumentException("Account is not active");
        }

        String token = jwtService.generateToken(user);
        RefreshToken refreshToken = createRefreshToken(user);

        return AuthResponse.builder()
                .token(token)
                .type("Bearer")
                .email(user.getEmail())
                .role(user.getRole().name())
                .refreshToken(refreshToken.getToken())
                .build();
    }
    @Override
    public UserResponse getCurrentUser() {

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        User user = (User) authentication.getPrincipal();

        return UserResponse.builder()
                .id(user.getId())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .email(user.getEmail())
                .role(user.getRole().name())
                .status(user.getStatus())
                .build();
    }

    private RefreshToken createRefreshToken(User user) {

        RefreshToken refreshToken = RefreshToken.builder()
                .token(UUID.randomUUID().toString())
                .expiryDate(LocalDateTime.now().plusDays(7))
                .revoked(false)
                .user(user)
                .build();

        return refreshTokenRepository.save(refreshToken);
    }

    @Override
    public AuthResponse refreshToken(String requestToken) {

        RefreshToken refreshToken = refreshTokenRepository.findByToken(requestToken)
                .orElseThrow(() -> new IllegalArgumentException("Invalid refresh token"));

        if (refreshToken.isRevoked()) {

            throw new InvalidCredentialsException("Refresh token revoked");
        }

        if (refreshToken.getExpiryDate().isBefore(LocalDateTime.now())) {
            throw new InvalidCredentialsException("Refresh token expired");
        }

        User user = refreshToken.getUser();

        if (!Boolean.TRUE.equals(user.getEnabled())
                || !"ACTIVE".equalsIgnoreCase(user.getStatus())) {
            throw new IllegalStateException("Account is disabled or inactive");
        }

        String newAccessToken = jwtService.generateToken(user);


        return AuthResponse.builder()
                .token(newAccessToken)
                .type("Bearer")
                .email(user.getEmail())
                .role(user.getRole().name())
                .build();

    }

    @Override
    public void logout(String requestToken) {

        RefreshToken refreshToken = refreshTokenRepository.findByToken(requestToken)
                .orElseThrow(() -> new IllegalArgumentException("Invalid refresh token"));

        refreshToken.setRevoked(true);
        refreshTokenRepository.save(refreshToken);
    }

    @Override
    public String forgotPassword(String email) {

        String normalizedEmail = email.trim().toLowerCase();

        Optional<User> optionalUser = userRepository.findByEmail(normalizedEmail);

        if (optionalUser.isEmpty()) {
            return "Si cette adresse existe, un e-mail de réinitialisation a été envoyé.";
        }

        User user = optionalUser.get();

        PasswordResetToken resetToken = PasswordResetToken.builder()
                .token(UUID.randomUUID().toString())
                .expiryDate(LocalDateTime.now().plusMinutes(15))
                .used(false)
                .user(user)
                .build();

        passwordResetTokenRepository.save(resetToken);

        String resetLink = "http://localhost:4200/reset-password?token="
                + resetToken.getToken();

        emailService.sendPasswordResetEmail(user.getEmail(), resetLink);

        return "Si cette adresse existe, un e-mail de réinitialisation a été envoyé.";
    }

    @Override
    public void resetPassword(String token, String newPassword) {

        PasswordResetToken resetToken = passwordResetTokenRepository.findByToken(token)
                .orElseThrow(() -> new IllegalArgumentException("Invalid reset token"));

        if (resetToken.isUsed()) {
            throw new IllegalArgumentException("Reset token already used");
        }

        if (resetToken.getExpiryDate().isBefore(LocalDateTime.now())) {
            throw new IllegalArgumentException("Reset token expired");
        }

        User user = resetToken.getUser();
        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        resetToken.setUsed(true);
        passwordResetTokenRepository.save(resetToken);
    }



    @Override
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public void deactivateUser(Long userId) {

        User user = userRepository.findById(userId)
                .orElseThrow(() ->
                        new IllegalArgumentException("User not found"));

        validateAdminProtection(user);

        // Toujours persister + Kafka (répare user_db si désynchronisé)
        refreshTokenRepository.revokeAllByUserId(userId);

        user.setEnabled(false);
        user.setStatus("INACTIVE");

        userRepository.save(user);
        writeAudit("DEACTIVATE", user);

        kafkaProducerService.sendUserDeactivatedEvent(
                new UserDeactivatedEvent(userId)
        );
    }

    @Override
    @PreAuthorize("hasRole('ADMIN')")
    public UserResponse createUser(CreateUserRequest request) {

        if (request.getRole() != Role.ADMIN
                && request.getRole() != Role.RECRUITER) {
            throw new IllegalArgumentException(
                    "Only ADMIN and RECRUITER roles are allowed"
            );
        }

        String email = request.getEmail().trim().toLowerCase();

        if (userRepository.existsByEmail(email)) {
            throw new IllegalArgumentException("Email already exists");
        }

        User user = User.builder()
                .firstName(request.getFirstName())
                .lastName(request.getLastName())
                .email(email)
                .password(passwordEncoder.encode(request.getPassword()))
                .phone(request.getPhone())
                .role(request.getRole())
                .enabled(true)
                .status("ACTIVE")
                .createdAt(LocalDateTime.now())
                .build();

        user = userRepository.save(user);
        writeAudit("CREATE", user);

        kafkaProducerService.sendUserRegisteredEvent(
                new UserRegisteredEvent(
                        user.getId(),
                        user.getFirstName(),
                        user.getLastName(),
                        user.getEmail(),
                        user.getRole().name()
                )
        );

        return UserResponse.builder()
                .id(user.getId())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .email(user.getEmail())
                .role(user.getRole().name())
                .status(user.getStatus())
                .build();
    }
    @Override
    @PreAuthorize("hasAnyRole('ADMIN', 'RECRUITER')")
    public UserResponse createCandidate(CreateUserRequest request) {

        String email = request.getEmail().trim().toLowerCase();

        if (userRepository.existsByEmail(email)) {
            throw new IllegalArgumentException("Email already exists");
        }

        User user = User.builder()
                .firstName(request.getFirstName())
                .lastName(request.getLastName())
                .email(email)
                .password(passwordEncoder.encode(request.getPassword()))
                .phone(request.getPhone())
                .role(Role.CANDIDATE)
                .enabled(true)
                .status("ACTIVE")
                .createdAt(LocalDateTime.now())
                .build();

        user = userRepository.save(user);
        writeAudit("CREATE", user);

        kafkaProducerService.sendUserRegisteredEvent(
                new UserRegisteredEvent(
                        user.getId(),
                        user.getFirstName(),
                        user.getLastName(),
                        user.getEmail(),
                        user.getRole().name()
                )
        );

        return UserResponse.builder()
                .id(user.getId())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .email(user.getEmail())
                .role(user.getRole().name())
                .status(user.getStatus())
                .build();
    }



    private void validateAdminProtection(User user) {

        if (user.getEmail().equalsIgnoreCase(actorEmail())) {
            throw new IllegalStateException(
                    "You cannot deactivate or delete your own account"
            );
        }

        boolean activeAdmin =
                user.getRole() == Role.ADMIN
                        && Boolean.TRUE.equals(user.getEnabled())
                        && "ACTIVE".equalsIgnoreCase(user.getStatus());

        if (activeAdmin
                && userRepository.countByRoleAndEnabledTrueAndStatusIgnoreCase(
                Role.ADMIN, "ACTIVE") <= 1) {

            throw new IllegalStateException(
                    "Cannot deactivate or delete the last active administrator"
            );
        }
    }


    @Override
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public void deleteUserPermanently(Long userId) {

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "User not found"
                ));

        validateAdminProtection(user);
        writeAudit("DELETE", user);

        UserDeletedEvent event = new UserDeletedEvent(userId);

        String payload;
        try {
            payload = objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(
                    "Impossible de préparer USER_DELETED", e
            );
        }

        OutboxEvent outbox = new OutboxEvent();
        outbox.setTopic("user-deleted-events");
        outbox.setEventKey(userId.toString());
        outbox.setPayload(payload);

        outboxEventRepository.save(outbox);

        refreshTokenRepository.deleteAllByUserId(userId);
        passwordResetTokenRepository.deleteAllByUserId(userId);

        userRepository.delete(user);
    }
    @Override
    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public void reactivateUser(Long userId) {

        User user = userRepository.findById(userId)
                .orElseThrow(() ->
                        new IllegalArgumentException("User not found"));

        // Toujours forcer ACTIVE + republier Kafka :
        // l'admin UI lit user_db.enabled ; un early-return laissait
        // user-service désynchronisé (auth ACTIVE / user disabled).
        user.setEnabled(true);
        user.setStatus("ACTIVE");

        userRepository.save(user);
        writeAudit("REACTIVATE", user);
        kafkaProducerService.sendUserReactivatedEvent(
                new UserReactivatedEvent(userId)
        );
    }


}