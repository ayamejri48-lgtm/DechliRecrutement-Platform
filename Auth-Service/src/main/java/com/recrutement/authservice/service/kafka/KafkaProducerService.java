
package com.recrutement.authservice.service.kafka;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recrutement.authservice.event.UserRegisteredEvent;
import com.recrutement.authservice.event.UserDeactivatedEvent;
import com.recrutement.authservice.event.UserDeletedEvent;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import com.recrutement.authservice.event.UserReactivatedEvent;
@Service
public class KafkaProducerService {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public KafkaProducerService(
            KafkaTemplate<String, String> kafkaTemplate,
            ObjectMapper objectMapper
    ) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    public void sendUserRegisteredEvent(UserRegisteredEvent event) {
        try {
            String json = objectMapper.writeValueAsString(event);

            kafkaTemplate.send(
                    "user-events",
                    event.getUserId().toString(),
                    json
            );

        } catch (JsonProcessingException e) {
            throw new IllegalStateException(
                    "Impossible de sérialiser USER_REGISTERED", e
            );
        }
    }

    public void sendUserDeactivatedEvent(UserDeactivatedEvent event) {
        try {
            String json = objectMapper.writeValueAsString(event);

            kafkaTemplate.send(
                    "user-deactivated-events",
                    event.getUserId().toString(),
                    json
            );

        } catch (JsonProcessingException e) {
            throw new IllegalStateException(
                    "Impossible de sérialiser USER_DEACTIVATED", e
            );
        }
    }

    public void sendUserDeletedEvent(UserDeletedEvent event) {
        try {
            String json = objectMapper.writeValueAsString(event);

            kafkaTemplate.send(
                    "user-deleted-events",
                    event.getUserId().toString(),
                    json
            );

        } catch (JsonProcessingException e) {
            throw new IllegalStateException(
                    "Impossible de sérialiser USER_DELETED", e
            );
        }
    }

    public void sendUserReactivatedEvent(UserReactivatedEvent event) {
        try {
            String json = objectMapper.writeValueAsString(event);

            kafkaTemplate.send(
                    "user-reactivated-events",
                    event.getUserId().toString(),
                    json
            );

        } catch (JsonProcessingException e) {
            throw new IllegalStateException(
                    "Impossible de sérialiser USER_REACTIVATED", e
            );
        }
    }
}
