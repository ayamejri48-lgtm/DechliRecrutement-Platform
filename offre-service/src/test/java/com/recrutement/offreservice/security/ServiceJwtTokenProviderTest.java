package com.recrutement.offreservice.security;

import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServiceJwtTokenProviderTest {

    @Test
    void mint_containsServiceClaims() throws Exception {
        ServiceJwtTokenProvider provider = new ServiceJwtTokenProvider(
                "InternalSvcJwtSecretKey_DechliRecrutement_HS256_ChangeMe!",
                "offre-service",
                "user-service",
                60
        );

        String header = provider.createAuthorizationHeader();
        assertTrue(header.startsWith("Bearer "));

        SignedJWT jwt = SignedJWT.parse(header.substring("Bearer ".length()));
        assertEquals("offre-service", jwt.getJWTClaimsSet().getIssuer());
        assertEquals("offre-service", jwt.getJWTClaimsSet().getSubject());
        assertTrue(jwt.getJWTClaimsSet().getAudience().contains("user-service"));
        assertEquals("SERVICE", jwt.getJWTClaimsSet().getStringClaim("role"));
    }
}
