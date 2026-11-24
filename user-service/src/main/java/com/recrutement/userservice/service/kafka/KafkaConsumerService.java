
package com.recrutement.userservice.service.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.event.UserRegisteredEvent;
import com.recrutement.userservice.service.UserService;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;
import com.recrutement.userservice.event.UserDeactivatedEvent;
import com.recrutement.userservice.event.UserDeletedEvent;
import com.recrutement.userservice.event.UserReactivatedEvent;

@Service
public class KafkaConsumerService {

    private final ObjectMapper objectMapper;
    private final UserService userService;

    public KafkaConsumerService(
            ObjectMapper objectMapper,
            UserService userService
    ) {
        this.objectMapper = objectMapper;
        this.userService = userService;
    }

    @KafkaListener(
            topics = "user-events",
            groupId = "user-service-group"
    )
    public void consumeUserRegisteredEvent(String message) {

        try {
            UserRegisteredEvent event = objectMapper.readValue(
                    message,
                    UserRegisteredEvent.class
            );

            User user = userService.createUserFromEvent(event);

            System.out.println("User profile created/verified:");
            System.out.println("User ID: " + user.getId());
            System.out.println("Email: " + user.getEmail());
            System.out.println("Role: " + user.getRole());

        } catch (Exception e) {

            System.err.println(
                    "Erreur lors du traitement de USER_REGISTERED : "
                            + e.getMessage()
            );

            throw new IllegalStateException(
                    "Échec du traitement de USER_REGISTERED",
                    e
            );
        }
    }
    @KafkaListener(
            topics = "user-deactivated-events",
            groupId = "user-service-group"
    )
    public void consumeUserDeactivatedEvent(String message) {

        try {
            UserDeactivatedEvent event = objectMapper.readValue(
                    message,
                    UserDeactivatedEvent.class
            );

            userService.deactivateUser(event.getUserId());

        } catch (Exception e) {
            throw new IllegalStateException(
                    "Échec du traitement de USER_DEACTIVATED",
                    e
            );
        }
    }
    @KafkaListener(
            topics = "user-deleted-events",
            groupId = "user-service-group"
    )
    public void consumeUserDeletedEvent(String message) {
        try {
            UserDeletedEvent event = objectMapper.readValue(
                    message,
                    UserDeletedEvent.class
            );

            userService.deleteUserFromEvent(event.getUserId());

        } catch (Exception e) {
            throw new IllegalStateException(
                    "Échec du traitement de USER_DELETED",
                    e
            );
        }
    }

    @KafkaListener(
            topics = "user-reactivated-events",
            groupId = "user-service-group"
    )
    public void consumeUserReactivatedEvent(String message) {
        try {
            UserReactivatedEvent event = objectMapper.readValue(
                    message,
                    UserReactivatedEvent.class
            );

            userService.reactivateUser(event.getUserId());

        } catch (Exception e) {
            throw new IllegalStateException(
                    "Échec du traitement de USER_REACTIVATED",
                    e
            );
        }
    }

}
