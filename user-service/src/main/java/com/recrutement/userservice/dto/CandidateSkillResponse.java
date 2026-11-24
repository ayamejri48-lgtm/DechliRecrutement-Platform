
package com.recrutement.userservice.dto;

import com.recrutement.userservice.entity.SkillLevel;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class CandidateSkillResponse {

    private Long id;
    private String name;
    private SkillLevel level;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
