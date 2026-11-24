package com.recrutement.offreservice.event;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class OffrePublishedEvent {
    private Long offreId;
    private String title;
    private Long recruiterId;
}
