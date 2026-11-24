package com.recrutement.userservice.config;

import com.recrutement.userservice.repository.UserRepository;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.core.annotation.Order;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.List;

@Configuration
public class SecurityConfig {

    @Value("${jwt.secret}")
    private String jwtSecret;

    @Value("${internal.jwt.secret}")
    private String internalJwtSecret;

    @Value("${internal.jwt.audience}")
    private String internalAudience;

    @Value("${internal.jwt.issuer}")
    private String internalIssuer;

    private final UserRepository userRepository;

    public SecurityConfig(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Bean
    @Order(1)
    public SecurityFilterChain internalSecurityFilterChain(
            HttpSecurity http,
            @Qualifier("serviceJwtDecoder") JwtDecoder serviceJwtDecoder,
            JwtAuthenticationConverter jwtAuthenticationConverter
    ) throws Exception {
        http
                .securityMatcher("/internal/**")
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/internal/candidates/**")
                        .hasRole("SERVICE")
                        .anyRequest().denyAll()
                )
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt
                                .decoder(serviceJwtDecoder)
                                .jwtAuthenticationConverter(jwtAuthenticationConverter)
                        )
                );

        return http.build();
    }

    @Bean
    @Order(2)
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            @Qualifier("userJwtDecoder") JwtDecoder userJwtDecoder,
            JwtAuthenticationConverter jwtAuthenticationConverter
    ) throws Exception {

        http
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth

                        .requestMatchers("/users/me").authenticated()
                        .requestMatchers("/users/me/cvs/**").hasRole("CANDIDATE")
                        .requestMatchers("/users/me/cvs").hasRole("CANDIDATE")

                        .requestMatchers(
                                HttpMethod.GET,
                                "/users/candidates",
                                "/users/candidates/*"
                        ).hasAnyRole("ADMIN", "RECRUITER")

                        .requestMatchers("/users").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/users/bootstrap").hasRole("ADMIN")

                        .requestMatchers(HttpMethod.DELETE, "/users/*/profile").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PATCH, "/users/*/presence").hasRole("ADMIN")

                        .requestMatchers(
                                "/users/skills/ajouter",
                                "/users/skills/consulter",
                                "/users/skills/consulter/*",
                                "/users/skills/modifier/*",
                                "/users/skills/supprimer/*"
                        ).hasRole("CANDIDATE")

                        .requestMatchers("/users/experiences/**")
                        .hasRole("CANDIDATE")

                        .requestMatchers("/users/educations/**")
                        .hasRole("CANDIDATE")
                        .requestMatchers("/users/**").authenticated()

                        .requestMatchers("/notifications", "/notifications/**").authenticated()

                        .anyRequest().denyAll()
                )
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt
                                .decoder(userJwtDecoder)
                                .jwtAuthenticationConverter(jwtAuthenticationConverter)
                        )
                );

        return http.build();
    }

    @Bean
    @Primary
    @Qualifier("userJwtDecoder")
    public JwtDecoder userJwtDecoder() {

        SecretKey secretKey = new SecretKeySpec(
                jwtSecret.getBytes(StandardCharsets.UTF_8),
                "HmacSHA256"
        );

        NimbusJwtDecoder decoder = NimbusJwtDecoder
                .withSecretKey(secretKey)
                .build();

        OAuth2TokenValidator<Jwt> accountValidator = jwt -> {

            String email = jwt.getSubject();

            boolean active = email != null
                    && userRepository.findByEmail(email)
                    .map(user -> Boolean.TRUE.equals(user.getEnabled()))
                    .orElse(false);

            if (!active) {
                return OAuth2TokenValidatorResult.failure(
                        new OAuth2Error(
                                "invalid_token",
                                "Account disabled or deleted",
                                null
                        )
                );
            }

            return OAuth2TokenValidatorResult.success();
        };

        decoder.setJwtValidator(
                new DelegatingOAuth2TokenValidator<>(
                        JwtValidators.createDefault(),
                        accountValidator
                )
        );

        return decoder;
    }

    @Bean
    @Qualifier("serviceJwtDecoder")
    public JwtDecoder serviceJwtDecoder() {
        SecretKey secretKey = new SecretKeySpec(
                padKey(internalJwtSecret),
                "HmacSHA256"
        );

        NimbusJwtDecoder decoder = NimbusJwtDecoder
                .withSecretKey(secretKey)
                .build();

        OAuth2TokenValidator<Jwt> audienceValidator = jwt -> {
            Object aud = jwt.getClaims().get(JwtClaimNames.AUD);
            boolean ok = false;
            if (aud instanceof String s) {
                ok = internalAudience.equals(s);
            } else if (aud instanceof Collection<?> c) {
                ok = c.contains(internalAudience);
            }
            if (!ok) {
                return OAuth2TokenValidatorResult.failure(
                        new OAuth2Error("invalid_token", "audience invalide", null)
                );
            }
            return OAuth2TokenValidatorResult.success();
        };

        OAuth2TokenValidator<Jwt> issuerValidator = jwt -> {
            if (!internalIssuer.equals(jwt.getClaimAsString(JwtClaimNames.ISS))
                    && !internalIssuer.equals(jwt.getIssuer() != null
                    ? jwt.getIssuer().toString() : null)) {
                return OAuth2TokenValidatorResult.failure(
                        new OAuth2Error("invalid_token", "issuer invalide", null)
                );
            }
            return OAuth2TokenValidatorResult.success();
        };

        OAuth2TokenValidator<Jwt> roleValidator = jwt -> {
            if (!"SERVICE".equals(jwt.getClaimAsString("role"))) {
                return OAuth2TokenValidatorResult.failure(
                        new OAuth2Error("invalid_token", "role SERVICE requis", null)
                );
            }
            return OAuth2TokenValidatorResult.success();
        };

        decoder.setJwtValidator(
                new DelegatingOAuth2TokenValidator<>(
                        JwtValidators.createDefault(),
                        issuerValidator,
                        audienceValidator,
                        roleValidator
                )
        );

        return decoder;
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {

        JwtAuthenticationConverter converter =
                new JwtAuthenticationConverter();

        converter.setJwtGrantedAuthoritiesConverter(
                (Converter<Jwt, Collection<GrantedAuthority>>) this::extractAuthorities
        );

        return converter;
    }

    private Collection<GrantedAuthority> extractAuthorities(Jwt jwt) {

        String role = jwt.getClaimAsString("role");

        if (role == null || role.isBlank()) {
            return List.of();
        }

        return List.of(
                new SimpleGrantedAuthority("ROLE_" + role)
        );
    }

    static byte[] padKey(String secret) {
        byte[] raw = secret.getBytes(StandardCharsets.UTF_8);
        if (raw.length >= 32) {
            return raw;
        }
        byte[] padded = new byte[32];
        System.arraycopy(raw, 0, padded, 0, raw.length);
        return padded;
    }
}
