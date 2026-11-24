
package com.recrutement.userservice.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Getter
@Setter
public class EducationRequest {

    @NotBlank
    private String institution;

    @NotBlank
    private String degree;

    @NotBlank
    private String fieldOfStudy;

    @NotNull
    private LocalDate startDate;

    private LocalDate endDate;
}
