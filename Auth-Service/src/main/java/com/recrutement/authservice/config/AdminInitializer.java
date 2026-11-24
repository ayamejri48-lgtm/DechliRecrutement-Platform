
package com.recrutement.authservice.config;

import com.recrutement.authservice.entity.User;
import com.recrutement.authservice.enums.Role;
import com.recrutement.authservice.event.UserRegisteredEvent;
import com.recrutement.authservice.repository.UserRepository;
import com.recrutement.authservice.service.kafka.KafkaProducerService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

@Component
@ConditionalOnProperty(
        name = "app.bootstrap.admin.enabled",
        havingValue = "true"
)
public class AdminInitializer implements CommandLineRunner {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final KafkaProducerService kafkaProducerService;

    @Value("${app.bootstrap.admin.email}")
    private String email;

    @Value("${app.bootstrap.admin.password}")
    private String password;

    public AdminInitializer(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            KafkaProducerService kafkaProducerService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.kafkaProducerService = kafkaProducerService;
    }

    @Override
    public void run(String... args) {

        if (userRepository.existsByRole(Role.ADMIN)) {
            return;
        }

        if (password == null || password.length() < 12) {
            throw new IllegalStateException(
                    "Admin password must contain at least 12 characters"
            );
        }

        String normalizedEmail = email.trim().toLowerCase();

        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new IllegalStateException(
                    "Bootstrap admin email already exists"
            );
        }

        User admin = User.builder()
                .firstName("System")
                .lastName("Admin")
                .email(normalizedEmail)
                .password(passwordEncoder.encode(password))
                .role(Role.ADMIN)
                .enabled(true)
                .status("ACTIVE")
                .createdAt(LocalDateTime.now())
                .build();

        admin = userRepository.save(admin);

        kafkaProducerService.sendUserRegisteredEvent(
                new UserRegisteredEvent(
                        admin.getId(),
                        admin.getFirstName(),
                        admin.getLastName(),
                        admin.getEmail(),
                        admin.getRole().name()
                )
        );
    }
}
