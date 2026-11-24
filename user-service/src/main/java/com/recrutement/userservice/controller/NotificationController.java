
package com.recrutement.userservice.controller;

import com.recrutement.userservice.entity.Notification;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.service.NotificationService;
import com.recrutement.userservice.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;
    private final UserService userService;

    @GetMapping
    public List<Notification> getMyNotifications(Authentication authentication) {
        User user = userService.getUserByEmail(authentication.getName());
        return notificationService.getMyNotifications(user.getId());
    }

    @GetMapping("/unread-count")
    public Map<String, Long> getUnreadCount(Authentication authentication) {
        User user = userService.getUserByEmail(authentication.getName());
        long count = notificationService.countUnreadNotifications(user.getId());
        return Map.of("count", count);
    }

    @PatchMapping("/{id}/read")
    public ResponseEntity<Void> markAsRead(
            @PathVariable Long id,
            Authentication authentication) {

        User user = userService.getUserByEmail(authentication.getName());
        notificationService.markAsRead(id, user.getId());

        return ResponseEntity.noContent().build();
    }
}
