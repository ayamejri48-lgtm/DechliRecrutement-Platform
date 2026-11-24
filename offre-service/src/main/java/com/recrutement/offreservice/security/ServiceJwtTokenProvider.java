package com.recrutement.offreservice.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * Émet un JWT de service court (HS256, secret interne ≠ jwt.secret user).
 */
@Component
public class ServiceJwtTokenProvider {

    private final byte[] secret;
    private final String issuer;
    private final String audience;
    private final long ttlSeconds;

    public ServiceJwtTokenProvider(
            @Value("${internal.jwt.secret}") String secret,
            @Value("${internal.jwt.issuer}") String issuer,
            @Value("${internal.jwt.audience}") String audience,
            @Value("${internal.jwt.ttl-seconds:60}") long ttlSeconds) {
        this.secret = padKey(secret);
        this.issuer = issuer;
        this.audience = audience;
        this.ttlSeconds = ttlSeconds;
    }

    public String createAuthorizationHeader() {
        return "Bearer " + mint();
    }

    public String mint() {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .jwtID(UUID.randomUUID().toString())
                .subject(issuer)
                .issuer(issuer)
                .audience(audience)
                .claim("role", "SERVICE")
                .claim("scope", "candidate.profile.read candidate.cv.read")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(ttlSeconds)))
                .build();

        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        try {
            jwt.sign(new MACSigner(secret));
        } catch (JOSEException e) {
            throw new IllegalStateException("Impossible d'émettre le JWT de service", e);
        }
        return jwt.serialize();
    }

    private static byte[] padKey(String secret) {
        byte[] raw = secret.getBytes(StandardCharsets.UTF_8);
        if (raw.length >= 32) {
            return raw;
        }
        byte[] padded = new byte[32];
        System.arraycopy(raw, 0, padded, 0, raw.length);
        return padded;
    }
}
